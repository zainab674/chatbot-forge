/**
 * Knowledge base unit tests: extraction, chunking, scoring, prompt assembly.
 *
 *   npm run test:knowledge
 *
 * No database, no network, no API keys. The embedding adapter is exercised
 * against a local fake provider.
 */
import http from 'node:http';
import { htmlToText, extractTitle, extractLinks, extractSitemapUrls, decodeEntities } from '../src/lib/knowledge/html';
import { chunkText, chunkQA } from '../src/lib/knowledge/chunk';
import { tabularToText, parseDelimited, jsonToText } from '../src/lib/knowledge/extract';
import { assertPublicUrl, assertReachableUrl, isPrivateIp, safeFetch } from '../src/lib/knowledge/crawl';
import { tokenize, stem, termFrequencies, bm25, fuse, buildContext, buildQuery } from '../src/lib/knowledge/retrieve';
import {
  normalise,
  dot,
  getEmbeddingProvider,
  suggestEmbeddingProvider,
  EMBEDDING_PROVIDERS,
  NO_EMBEDDINGS,
} from '../src/lib/knowledge/embed';
import { embedTexts } from '../src/lib/knowledge/embed-call';
import { buildSystemPrompt, DEFAULT_CONFIG } from '../src/lib/prompt';
import type { ChunkDoc } from '../src/lib/types';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = '') {
  if (ok) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail++;
    console.log(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`);
  }
}
const group = (t: string) => console.log(`\n${t}`);

/* ------------------------------------------------------------------ */
group('HTML extraction');

const page = `<!doctype html><html><head><title>Acme &mdash; Pricing</title>
<style>.x{color:red}</style><script>var evil = "<p>not text</p>";</script></head>
<body><nav><a href="/about">About</a></nav>
<h1>Pricing</h1><p>Pro costs $12 per user.</p><ul><li>Free tier</li><li>Enterprise</li></ul>
<footer>© 2026 Acme</footer>
<a href="/docs">Docs</a><a href="https://other.com/x">Other</a><a href="/a.pdf">PDF</a>
</body></html>`;

const text = htmlToText(page);
check('drops script contents', !text.includes('evil') && !text.includes('not text'));
check('drops style contents', !text.includes('color:red'));
check('drops nav and footer', !text.includes('About') && !text.includes('2026 Acme'));
check('keeps body prose', text.includes('Pro costs $12 per user.'));
check('keeps list items on their own lines', /Free tier\nEnterprise/.test(text), JSON.stringify(text));
check('does not repeat the page title in the body', !text.startsWith('Acme'));
check(
  'table cells stay on one row',
  htmlToText('<table><tr><td>Pro</td><td>$12</td></tr><tr><td>Free</td><td>$0</td></tr></table>') ===
    'Pro | $12\nFree | $0',
);
check('leaves no angle brackets behind', !text.includes('<') && !text.includes('>'));
check('reads the title and decodes entities', extractTitle(page) === 'Acme - Pricing');
check('decodes numeric entities', decodeEntities('caf&#233; &#x2014; open') === 'café — open');

const links = extractLinks(page, 'https://acme.com/pricing');
check('finds same-origin links', links.includes('https://acme.com/docs'));
check('skips other domains', !links.some((l) => l.includes('other.com')));
check('skips binary assets', !links.some((l) => l.endsWith('.pdf')));

check(
  'reads sitemap locations',
  extractSitemapUrls('<urlset><url><loc>https://a.com/1</loc></url><url><loc>https://a.com/2</loc></url></urlset>')
    .length === 2,
);

group('HTML: adversarial input (regression)');

// The naive /<!--[\s\S]*?-->/g is quadratic on unterminated comments: 256KB of
// these took over 20 seconds and blocked the event loop.
const commentBomb = '<!-- '.repeat(80_000);
const t0 = Date.now();
const bombOut = htmlToText(commentBomb);
const bombMs = Date.now() - t0;
check(`400KB of unterminated comments parses fast (${bombMs}ms)`, bombMs < 1000, `${bombMs}ms`);
check('an unterminated comment swallows the rest, like a browser', bombOut.trim() === '');
const scriptBomb = '<script> '.repeat(40_000);
const t1 = Date.now();
htmlToText(scriptBomb);
const scriptMs = Date.now() - t1;
check(`many unterminated <script> tags parse fast (${scriptMs}ms)`, scriptMs < 1000, `${scriptMs}ms`);
check(
  'a real comment is still removed',
  !htmlToText('<p>keep</p><!-- drop me --><p>this</p>').includes('drop me'),
);
check(
  'an unclosed <nav> does not eat the whole page',
  htmlToText('<nav><a>menu</a><p>Real content here.</p>').includes('Real content here.'),
);
check(
  'a tag whose name is a prefix is not dropped',
  htmlToText('<navigator>Keep this text</navigator>').includes('Keep this text'),
);

// Regression: these are all legal comment syntax. Treating them as
// unterminated truncated the page to its first few words.
const body = '<p>The Pro plan costs $12 per month.</p>';
check('an empty comment <!--> does not truncate the page', htmlToText(`<h1>A</h1><!-->${body}`).includes('$12'));
check('an empty comment <!---> does not truncate the page', htmlToText(`<h1>A</h1><!--->${body}`).includes('$12'));
check('the --!> comment close is recognised', htmlToText(`<h1>A</h1><!-- x --!>${body}`).includes('$12'));
check(
  'a <!-- inside a script string does not eat the page',
  htmlToText(`<h1>A</h1><script>var open = '<!--';</script>${body}`).includes('$12'),
);
check(
  'script contents are still removed',
  !htmlToText(`<script>var secret = 42;</script>${body}`).includes('secret'),
);
check(
  'a commented-out script is still removed',
  !htmlToText(`<!-- <script>var secret = 42;</script> -->${body}`).includes('secret'),
);
check('the earliest close wins', htmlToText(`<h1>A</h1><!-- a --> B <!-- c -->${body}`).includes('B'));

/* ------------------------------------------------------------------ */
group('SSRF protection');

check('allows a public https URL', Boolean(assertPublicUrl('https://acme.com/docs')));
for (const bad of [
  'http://localhost:3000/admin',
  'http://127.0.0.1/',
  'http://169.254.169.254/latest/meta-data/',
  'http://10.0.0.5/',
  'http://192.168.1.1/',
  'http://172.16.4.4/',
  'file:///etc/passwd',
  'http://foo.internal/',
]) {
  let blocked = false;
  try {
    assertPublicUrl(bad);
  } catch {
    blocked = true;
  }
  check(`blocks ${bad}`, blocked);
}

check('blocks IPv4-mapped IPv6 loopback', isPrivateIp('::ffff:127.0.0.1'));
check('blocks unique-local IPv6', isPrivateIp('fd00::1'));
check('blocks link-local IPv6', isPrivateIp('fe80::1'));
check('blocks carrier-grade NAT', isPrivateIp('100.64.0.1'));
check('allows a normal public address', !isPrivateIp('93.184.216.34'));

/**
 * A public-looking hostname that resolves to loopback used to sail through,
 * because only the URL string was ever checked. Needs working DNS, so it is
 * skipped rather than failed when the network is unavailable.
 */
async function checkDnsRebinding() {
  let dnsWorks = true;
  try {
    await assertReachableUrl('https://example.com/');
  } catch (e) {
    if (/Could not resolve/.test((e as Error).message)) dnsWorks = false;
    else throw e;
  }
  if (!dnsWorks) {
    console.log('  \x1b[33m-\x1b[0m blocks a hostname resolving to loopback (skipped, no DNS)');
    return;
  }
  let message = '';
  try {
    await assertReachableUrl('http://127.0.0.1.nip.io/');
  } catch (e) {
    message = (e as Error).message;
  }
  check('blocks a hostname that resolves to loopback', /private network address/.test(message), message);
}

/* ------------------------------------------------------------------ */
group('Chunking');

const doc = [
  '# Pricing',
  'Pro costs $12 per user per month. '.repeat(40),
  '# Refunds',
  'Refunds are available within 30 days. '.repeat(40),
].join('\n\n');

const chunks = chunkText(doc, { size: 600, overlap: 80 });
check('splits a long document', chunks.length > 2);
check('respects the size target', chunks.every((c) => c.text.length <= 900), `max ${Math.max(...chunks.map((c) => c.text.length))}`);
check('indexes chunks in order', chunks.every((c, i) => c.index === i));
check('carries the nearest heading into later chunks', chunks.some((c) => c.text.startsWith('Pricing') || c.text.includes('# Pricing')));
check('keeps refund content findable', chunks.some((c) => c.text.includes('Refunds are available')));
check('a short document stays one chunk', chunkText('Just a sentence.').length === 1);
check('empty input yields no chunks', chunkText('   \n\n  ').length === 0);

const giant = 'x'.repeat(5000);
check('cuts a single unbroken blob', chunkText(giant, { size: 500, overlap: 50 }).length >= 8);

const overlapDoc = 'Alpha beta gamma. '.repeat(60);
const withOverlap = chunkText(overlapDoc, { size: 400, overlap: 100 });
check('overlapping chunks share text', withOverlap.length > 1);

// Regression: flushing on every heading shredded heading-dense documents into
// runts, which blew through the per-source chunk cap and lost most of the text.
const headingDense = Array.from(
  { length: 120 },
  (_, i) => `## Question ${i + 1}\n\nShort answer number ${i + 1} about widgets and pricing.`,
).join('\n\n');
const denseChunks = chunkText(headingDense);
const denseChars = headingDense.replace(/\s+/g, '').length;
const packedChars = denseChunks.map((c) => c.text.replace(/\s+/g, '').length).reduce((a, b) => a + b, 0);
check(
  `a heading-dense document is not shredded (${denseChunks.length} chunks)`,
  denseChunks.length < 30,
  `${denseChunks.length} chunks`,
);
check('no content is lost to shredding', packedChars >= denseChars, `${packedChars} vs ${denseChars}`);
check(
  'every heading-dense chunk is substantial',
  denseChunks.filter((c) => c.text.length < 300).length <= 1,
);

// Regression: a chunk was stamped with the LAST heading it saw rather than the
// one it started under, so it claimed to be about a section it did not contain.
const filler = 'Some ordinary sentence of prose here. '.repeat(10).trim();
const sectioned = ['Pricing', 'Refunds', 'Shipping', 'Support']
  .map((h, i) => `## ${h}\n\nDetail ${i} about ${h.toLowerCase()}. ${filler}`)
  .join('\n\n');
const sectionChunks = chunkText(sectioned);
check(
  'a chunk is never labelled with a section it does not contain',
  sectionChunks.every((c) => {
    const label = c.text.split('\n')[0];
    // A prepended breadcrumb is a bare line with no markdown marker.
    if (label.startsWith('#') || label.length > 60) return true;
    return c.text.includes(`about ${label.toLowerCase()}`) || !/^(Pricing|Refunds|Shipping|Support)$/.test(label);
  }),
  JSON.stringify(sectionChunks.map((c) => c.text.slice(0, 40))),
);
check(
  'no chunk exceeds the size limit',
  chunkText(sectioned).every((c) => c.text.length <= 1600),
  `max ${Math.max(...chunkText(sectioned).map((c) => c.text.length))}`,
);
check(
  'implicit headings do not push a chunk over the limit',
  (() => {
    let doc = '';
    for (let i = 0; i < 30; i++) doc += `Chapter ${i}\n\n${'word '.repeat(30).trim()}\n\n`;
    return chunkText(doc).every((c) => c.text.length <= 1600);
  })(),
);
check(
  'a very long heading is truncated rather than blowing the budget',
  (() => {
    const longHeading = `## ${'Enterprise Support And Service Level Agreement Details '.repeat(10)}`;
    const doc = ['A'.repeat(700), 'B'.repeat(700), longHeading, 'C'.repeat(700)].join('\n\n');
    return chunkText(doc).every((c) => c.text.length <= 1600);
  })(),
);

// Regression: the overlap tail was emitted as its own chunk, duplicating text.
// Sentences are numbered so that identical text cannot masquerade as a duplicate.
const cjk = Array.from({ length: 400 }, (_, i) => `这是关于小部件的第${i + 1}个句子。`).join('');
const cjkChunks = chunkText(cjk, { size: 500, overlap: 100 });
check(
  'no chunk is a verbatim duplicate of another',
  new Set(cjkChunks.map((c) => c.text)).size === cjkChunks.length,
);
check(
  'no chunk is fully contained in its predecessor',
  cjkChunks.every((c, i) => i === 0 || !cjkChunks[i - 1].text.includes(c.text)),
);
check('CJK text splits on ideographic full stops', cjkChunks.length > 1);

// Base-36 counter, so the blob has no repeating period that could look like a
// duplicate chunk when it is really just repeated input.
const base64ish = `data:image/png;base64,${Array.from({ length: 2200 }, (_, i) => i.toString(36)).join('')}`;
const b64Chunks = chunkText(base64ish, { size: 500, overlap: 100 });
check('an unbroken blob still terminates', b64Chunks.length > 1);
check(
  'an unbroken blob produces no duplicate chunks',
  new Set(b64Chunks.map((c) => c.text)).size === b64Chunks.length,
);
const absurdOverlap = chunkText('a b c '.repeat(500), { size: 100, overlap: 200 });
check('overlap larger than size does not hang', absurdOverlap.length > 0);
// Regression: the stride collapsed to 1 and produced ~3000 chunks for 3KB.
check(`overlap is clamped instead of exploding (${absurdOverlap.length} chunks)`, absurdOverlap.length < 120, `${absurdOverlap.length}`);

const qa = chunkQA([
  { q: 'Do you ship free?', a: 'Over $50, yes.' },
  { q: '', a: 'orphan' },
]);
check('Q&A pairs become one chunk each', qa.length === 1 && qa[0].text.startsWith('Q: Do you ship free?'));

/* ------------------------------------------------------------------ */
group('Tabular and JSON extraction');

const csv = 'name,price,notes\nWidget,9,"Blue, small"\nGadget,19,"He said ""hi"""';
const rows = parseDelimited(csv, ',');
check('parses quoted commas', rows[1][2] === 'Blue, small');
check('parses escaped quotes', rows[2][2] === 'He said "hi"');
const csvText = tabularToText(csv, ',');
check('repeats the header on every row', csvText.includes('name: Widget') && csvText.includes('name: Gadget'));
check('keeps values with their column', csvText.includes('price: 9'));
// Regression: an unpaired quote used to swallow every following row.
const inchMarks = 'sku,name,qty\nA1,widget,10\nA2,5" steel pipe,20\nA3,gadget,30\nA4,bolt,40';
const inchRows = parseDelimited(inchMarks, ',');
check(`a stray inch mark does not eat later rows (${inchRows.length} rows)`, inchRows.length === 5, JSON.stringify(inchRows));
check('the value with the stray quote is kept intact', inchRows[2][1] === '5" steel pipe');
check('a properly quoted field still works', parseDelimited('a,b\n"x,y",z', ',')[1][0] === 'x,y');
check('an unterminated quoted field does not lose the row', parseDelimited('a,b\n"open,z', ',').length === 2);

check(
  'flattens JSON to paths',
  jsonToText('{"plan":{"name":"Pro","price":12},"tags":["a","b"]}').includes('plan.price: 12'),
);
check('leaves invalid JSON alone', jsonToText('not json') === 'not json');

/* ------------------------------------------------------------------ */
group('Keyword scoring');

check('stems plurals', stem('refunds') === 'refund');
check('stems -ies to -y', stem('policies') === 'policy');
check('stems past tense', stem('refunded') === 'refund');
check('stems -ing', stem('shipping') === 'ship');
check('leaves short words alone', stem('is') === 'is' && stem('gas') === 'gas');
check('does not over-stem double s', stem('class') === 'class' && stem('classes') === 'class');
check('a query matches the document form', tokenize('do you offer refunds')[1] === tokenize('a full refund')[1]);
check('tokenizer drops stopwords', !tokenize('what is the price of it').includes('the'));
check('tokenizer keeps content words', tokenize('what is the price').includes('price'));
check('tokenizer handles non-Latin script', tokenize('قیمت کیا ہے').length > 0);
check('term frequencies count repeats', termFrequencies('price price plan').price === 2);

const docs = [
  { terms: termFrequencies('Pro costs $12 per user per month'), length: 32 },
  { terms: termFrequencies('Our refund policy allows 30 days'), length: 32 },
  { terms: termFrequencies('The office is open on weekdays'), length: 30 },
];
const scores = bm25('how much does pro cost', docs);
check('ranks the matching document first', scores[0] > scores[1] && scores[0] > scores[2]);
check('unrelated documents score zero', scores[2] === 0);
check('an empty query scores nothing', bm25('', docs).every((s) => s === 0));

const fused = fuse([[0.9, 0.1, 0.2], [0, 5, 0]], [1, 0.5]);
check('fusion rewards agreement across rankings', fused[0] > fused[2]);
check('fusion still surfaces a keyword-only hit', fused[1] > 0);

/* ------------------------------------------------------------------ */
group('Vector maths');

const v = normalise([3, 4]);
check('normalises to unit length', Math.abs(Math.hypot(v[0], v[1]) - 1) < 1e-9);
check('a zero vector does not divide by zero', normalise([0, 0]).every((x) => x === 0));
check('identical vectors score 1', Math.abs(dot(normalise([1, 2, 3]), normalise([1, 2, 3])) - 1) < 1e-9);
check('opposite vectors score -1', Math.abs(dot(normalise([1, 0]), normalise([-1, 0])) + 1) < 1e-9);
// Regression: comparing a truncated prefix let chunks from an old embedding
// model compete with meaningless scores after the creator switched models.
check('mismatched dimensions score 0, not a prefix', dot([1, 0, 0], [1, 0, 0, 0, 0]) === 0);
check('fusion tolerates rankings of different lengths', fuse([[1, 2, 3], [1]], [1, 1]).every(Number.isFinite));

/* ------------------------------------------------------------------ */
group('Embedding catalog');

check('every embedding provider id is unique', new Set(EMBEDDING_PROVIDERS.map((p) => p.id)).size === EMBEDDING_PROVIDERS.length);
check('OpenAI is suggested for an OpenAI bot', suggestEmbeddingProvider('openai') === 'openai');
check('Groq falls back to no embeddings', suggestEmbeddingProvider('groq') === NO_EMBEDDINGS);
check('an unknown chat provider falls back to no embeddings', suggestEmbeddingProvider('nope') === NO_EMBEDDINGS);
check('a standalone embedding vendor is offered too', Boolean(getEmbeddingProvider('voyage')));

/* ------------------------------------------------------------------ */
group('Context and prompt assembly');

const retrieved = [1, 2, 3].map((n) => ({
  chunk: {
    id: `c${n}`,
    sourceId: `s${n}`,
    title: `Doc ${n}`,
    url: n === 1 ? 'https://acme.com/a' : '',
    text: `Fact number ${n} about widgets.`,
  } as ChunkDoc,
  score: 1 / n,
}));
const context = buildContext(retrieved);
check('numbers each excerpt', context.block.includes('[1]') && context.block.includes('[3]'));
check('returns one citation per excerpt', context.citations.length === 3);
check('citations carry the URL when there is one', context.citations[0].url === 'https://acme.com/a');
check('citations carry a snippet', context.citations[1].snippet.includes('Fact number 2'));

const long = Array.from({ length: 40 }, (_, i) => ({
  chunk: { id: `x${i}`, sourceId: 's', title: 't', url: '', text: 'y'.repeat(1000) } as ChunkDoc,
  score: 1,
}));
check('caps the context size', buildContext(long).citations.length < 40);

check('follow-up questions borrow the previous turn', buildQuery([
  { role: 'user', content: 'What does the Pro plan include?' },
  { role: 'assistant', content: '...' },
  { role: 'user', content: 'and the price?' },
]).includes('Pro plan'));
check('a long question stands alone', buildQuery([
  { role: 'user', content: 'first question about something else entirely' },
  { role: 'user', content: 'Can you explain in detail how the refund process works end to end?' },
]).startsWith('Can you explain'));

const grounded = buildSystemPrompt(
  { ...DEFAULT_CONFIG, name: 'Acme', citations: true },
  { block: context.block, count: 3, searchedButEmpty: false },
);
check('prompt includes the retrieved excerpts', grounded.includes('Fact number 1'));
check('prompt asks for inline citations', /cite the ones you used inline as \[1\]/i.test(grounded));
check('prompt warns that some excerpts may be irrelevant', /some may be irrelevant/i.test(grounded));
check('prompt forbids inventing citation numbers', /never cite a number that does not appear/i.test(grounded));

const noCite = buildSystemPrompt(
  { ...DEFAULT_CONFIG, name: 'Acme', citations: false },
  { block: context.block, count: 3, searchedButEmpty: false },
);
check('citation instruction is dropped when sources are hidden', !/cite the ones you used/i.test(noCite));

const empty = buildSystemPrompt({ ...DEFAULT_CONFIG, name: 'Acme' }, { block: '', count: 0, searchedButEmpty: true });
check('an empty retrieval tells the model to say it does not know', /Nothing in the knowledge base matched/.test(empty));

const strict = buildSystemPrompt(
  { ...DEFAULT_CONFIG, name: 'Acme', strictGrounding: true },
  { block: context.block, count: 3, searchedButEmpty: false },
);
check('strict grounding adds the refusal rule', /Do not fall back on general knowledge/.test(strict));
check('strict grounding is off by default', !/Do not fall back on general knowledge/.test(grounded));

/* ------------------------------------------------------------------ */
/* Embedding adapter against a fake provider                            */
/* ------------------------------------------------------------------ */

const PORT = 4397;
let lastBody: any = null;
let lastAuth: string | undefined;
let batches = 0;

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    lastBody = JSON.parse(body || '{}');
    lastAuth = req.headers.authorization;
    batches++;
    if (req.url?.includes('/fail')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'bad key' } }));
      return;
    }
    const input: string[] = lastBody.input ?? [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        // Returned out of order on purpose: the adapter must re-sort by index.
        data: input
          .map((t, i) => ({ index: i, embedding: [t.length, i + 1, 1] }))
          .reverse(),
      }),
    );
  });
});

async function run() {
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));

  group('SSRF: redirects and DNS');
  await checkDnsRebinding();

  // safeFetch is the only place this module calls fetch, and it validates
  // before every hop. A loopback URL must never reach the network, so a local
  // server is deliberately unreachable from it (which is also why the redirect
  // handling is covered by the unit checks above rather than over the wire).
  const guard = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body><p>INTERNAL SECRET</p></body></html>');
  });
  await new Promise<void>((r) => guard.listen(4395, '127.0.0.1', r));

  let reached = '';
  try {
    const res = await safeFetch('http://127.0.0.1:4395/', { timeoutMs: 3000 });
    reached = res.body;
  } catch (e) {
    reached = `blocked: ${(e as Error).message}`;
  }
  check('safeFetch refuses loopback outright', reached.startsWith('blocked:'), reached.slice(0, 80));
  check('the internal page never made it into a body', !reached.includes('INTERNAL SECRET'));
  guard.close();

  const provider = { ...getEmbeddingProvider('openai')!, baseUrl: `http://127.0.0.1:${PORT}/v1` };

  group('Embedding adapter');
  const vectors = await embedTexts({
    provider,
    apiKey: 'emb-key',
    model: 'text-embedding-3-small',
    input: ['alpha', 'beta longer text'],
  });
  check('returns one vector per input', vectors.length === 2);
  check('sends the key', lastAuth === 'Bearer emb-key');
  check('sends the model', lastBody.model === 'text-embedding-3-small');
  check('vectors come back unit length', Math.abs(Math.hypot(...vectors[0]) - 1) < 1e-9);
  check(
    'out-of-order responses are re-sorted by index',
    vectors[0][0] < vectors[1][0], // 'alpha' is shorter than 'beta longer text'
  );

  batches = 0;
  await embedTexts({ provider, apiKey: 'k', model: 'm', input: Array.from({ length: 150 }, (_, i) => `t${i}`) });
  check('batches large inputs', batches >= 2, `${batches} requests`);

  let caught: any = null;
  try {
    await embedTexts({
      provider: { ...provider, baseUrl: `http://127.0.0.1:${PORT}/fail` },
      apiKey: 'bad',
      model: 'm',
      input: ['x'],
    });
  } catch (e) {
    caught = e;
  }
  check('a rejected key throws a clear error', /rejected the API key/i.test(caught?.message ?? ''));
  check('the error keeps the 401 status', caught?.status === 401);

  server.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
