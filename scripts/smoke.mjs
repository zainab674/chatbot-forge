/**
 * End-to-end smoke test.
 *
 *   node scripts/smoke.mjs
 *
 * Boots an in-memory MongoDB, a fake OpenAI-compatible model server, and the
 * built Next app, then exercises the whole path: create a bot → load its public
 * config → stream a chat reply → render the embed/chat pages → delete.
 * No real API keys or network calls involved.
 */
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const APP_PORT = 3311;
const MODEL_PORT = 4311;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const OWNER = 'smoke-owner-0123456789';

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
};

/* --- fake OpenAI-compatible provider ------------------------------------ */

/**
 * A bag-of-words hashing embedding. Not a real model, but it puts texts that
 * share vocabulary near each other, which is exactly the property retrieval is
 * being tested for.
 */
function fakeEmbedding(text, dims = 96) {
  const vec = new Array(dims).fill(0);
  for (const token of (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])) {
    let h = 0;
    for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) >>> 0;
    vec[h % dims] += 1;
  }
  return vec;
}

/**
 * A one-page PDF with a real text layer, written by hand so the test needs no
 * fixture file and no PDF library.
 */
function makePdf(lines) {
  const body = lines.map((l) => `(${l}) Tj T*`).join('\n');
  const content = `BT /F1 14 Tf 50 750 Td 18 TL\n${body}\nET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 0; i < objs.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** pdf-parse needs Node >= 20.16; older runtimes cannot exercise the PDF path. */
function canParsePdf() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 20 || (major === 20 && minor >= 16);
}

function startFakeModel() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        const auth = req.headers.authorization || '';

        if (req.url?.includes('/embeddings')) {
          const input = Array.isArray(parsed.input) ? parsed.input : [parsed.input];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: input.map((t, i) => ({ index: i, embedding: fakeEmbedding(String(t)) })) }));
          return;
        }

        // One model always fails, and quotes the key it rejected — which is what
        // OpenAI's 401 body actually does. That is how the test can tell whether
        // a platform key leaks through an upstream error to the visitor.
        if (parsed.model === 'gpt-4.1-mini') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: { message: `Incorrect API key provided: ${String(auth).replace('Bearer ', '')}.` },
          }));
          return;
        }

        const system = parsed.messages?.[0]?.role === 'system' ? parsed.messages[0].content : '';
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const words = [
          'Echo:',
          auth === 'Bearer test-key-12345' ? '[auth-ok]' : '[auth-missing]',
          system ? '[system-ok]' : '[system-missing]',
          parsed.messages?.at(-1)?.content ?? '',
          // Echoing the system prompt lets the test assert what the model was
          // actually shown, including any retrieved excerpts.
          `\n<<SYSTEM>>${system}<</SYSTEM>>`,
        ];
        for (const w of words) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w + ' ' } }] })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.listen(MODEL_PORT, '127.0.0.1', () => resolve(server));
  });
}

async function waitFor(url, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

// Owner identity: filled with a session cookie after signup below — creating a
// bot WITH an API key now requires an account. Anonymous drafts are exercised
// separately with plain x-owner-id headers.
const headers = { 'Content-Type': 'application/json' };
const strangerHeaders = { 'Content-Type': 'application/json', 'x-owner-id': 'someone-else-99999' };

function portFree(port) {
  // No host argument: binds the wildcard address, so a stale server listening
  // on :: (what `next start` binds) is detected too — 127.0.0.1 would miss it.
  return new Promise((resolve) => {
    const s = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => s.close(() => resolve(true)))
      .listen(port);
  });
}

async function main() {
  for (const p of [APP_PORT, MODEL_PORT]) {
    if (!(await portFree(p))) {
      console.error(`Port ${p} is already in use — stop whatever is listening there and re-run.`);
      process.exit(1);
    }
  }

  // Storage: either the fake in-process store (default, no setup) or a real
  // MongoDB when MONGODB_URI is provided.
  const useFakeDb = !process.env.MONGODB_URI;
  const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
  console.log(useFakeDb ? 'Using the in-process test store (set MONGODB_URI to test against real MongoDB).' : `Using MongoDB at ${uri}`);

  console.log('Starting fake model server…');
  const model = await startFakeModel();

  console.log('Starting Next.js…');
  // Spawn the binary directly (not via npx) and in its own process group, so
  // cleanup kills the real server rather than a wrapper. On Windows the .bin
  // entry is a .cmd shim, which only a shell can execute (and detached process
  // groups do not exist there).
  const win = process.platform === 'win32';
  const nextBin = path.join(process.cwd(), 'node_modules', '.bin', win ? 'next.cmd' : 'next');
  const app = spawn(nextBin, ['start', '-p', String(APP_PORT)], {
    detached: !win,
    shell: win,
    env: {
      ...process.env,
      MONGODB_URI: uri,
      MONGODB_DB: 'smoke_test',
      ENCRYPTION_SECRET: 'smoke-test-secret-key-not-for-production-use',
      // Makes the first account below the root admin, so the role checks
      // have somewhere to start.
      ADMIN_EMAIL: 'smoke@example.test',
      NEXT_PUBLIC_APP_URL: BASE,
      CF_FAKE_DB: useFakeDb ? '1' : '0',
      // The fake model server runs on loopback, which the endpoint guard
      // refuses by default — that guard is the fix for a bot being pointed at
      // an internal address, so the suite opts out of it rather than weakening it.
      ALLOW_PRIVATE_ENDPOINTS: '1',
      // Lets the platform-credit path reach the fake provider. That path
      // deliberately ignores a bot's custom endpoint, so without this there is
      // no way to exercise it without calling a real vendor.
      CF_TEST_PROVIDER_BASE_URL: `http://127.0.0.1:${MODEL_PORT}/v1`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.on('data', () => {});
  app.stderr.on('data', (d) => process.env.VERBOSE && process.stderr.write(d));

  // On Windows there are no process groups and killing the .cmd shim leaves
  // the actual node server running (and holding the port for the next run), so
  // take the whole tree down with taskkill instead.
  const killApp = () => {
    if (win) {
      // Synchronous on purpose: this also runs from the process 'exit' event,
      // where async work is silently abandoned.
      try {
        spawnSync('taskkill', ['/pid', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        /* already gone */
      }
      return;
    }
    try {
      process.kill(-app.pid, 'SIGKILL'); // whole group
    } catch {
      app.kill('SIGKILL');
    }
  };
  const cleanup = async () => {
    killApp();
    model.close();
  };
  process.on('exit', killApp);

  try {
    if (!(await waitFor(`${BASE}/`))) throw new Error('App did not start in time.');

    console.log('\nRunning checks:');

    // 0. account — saving an API key requires one.
    const signupRes = await fetch(`${BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'smoke@example.test', password: 'smoke-password-1', ownerId: OWNER }),
    });
    const session = (signupRes.headers.get('set-cookie') ?? '').match(/cf_session=[^;]+/)?.[0] ?? '';
    check('POST /api/auth/signup creates an account and a session', signupRes.ok && Boolean(session));
    const signupBody = await signupRes.json().catch(() => ({}));
    check('a new account starts with free credits', (signupBody.user?.credits ?? 0) > 0, JSON.stringify(signupBody).slice(0, 200));
    headers.cookie = session;

    // 1. create
    const createRes = await fetch(`${BASE}/api/bots`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Smoke Bot',
        tagline: 'testing testing',
        info: 'You only know about widgets. Widgets cost $9.',
        style: 'concise',
        provider: 'custom',
        customBaseUrl: `http://127.0.0.1:${MODEL_PORT}/v1`,
        model: 'fake-model-1',
        apiKey: 'test-key-12345',
        embeddingProvider: 'custom',
        embeddingModel: 'fake-embed-1',
        greeting: 'Hello from the smoke test',
        suggestions: ['What is a widget?'],
        accent: '#0ea5e9',
        theme: 'dark',
      }),
    });
    const created = await createRes.json();
    check('POST /api/bots creates a chatbot', createRes.status === 201 && created.bot?.id, JSON.stringify(created));
    const id = created.bot?.id;
    if (!id) throw new Error('No bot id returned.');

    check('API key is masked, never returned raw', created.bot.apiKeyMask === 'test••••2345' && !('apiKeyEnc' in created.bot));

    // 2. validation
    const badRes = await fetch(`${BASE}/api/bots`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: '', provider: 'openai', model: 'gpt-4o-mini' }),
    });
    check('POST /api/bots rejects a nameless bot', badRes.status === 400);

    // 3. list is owner-scoped
    const mine = await (await fetch(`${BASE}/api/bots`, { headers })).json();
    const theirs = await (await fetch(`${BASE}/api/bots`, { headers: strangerHeaders })).json();
    check('GET /api/bots lists my bot', mine.bots.some((b) => b.id === id));
    check('GET /api/bots hides it from another owner', theirs.bots.length === 0);

    const forbidden = await fetch(`${BASE}/api/bots/${id}`, { headers: strangerHeaders });
    check('Another owner cannot read the bot config', forbidden.status === 403);

    // 4. public config
    const pub = await (await fetch(`${BASE}/api/bots/${id}/public`)).json();
    check('GET public config returns theme + greeting', pub.bot?.accent === '#0ea5e9' && pub.bot?.theme === 'dark');

    // Themes beyond light/dark are stored and served like any other preset.
    const themed = await fetch(`${BASE}/api/bots/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ theme: 'ember' }),
    });
    check('PATCH accepts a preset theme', themed.ok, String(themed.status));
    const themedPublic = await (await fetch(`${BASE}/api/bots/${id}/public`)).json();
    check('the preset theme reaches the public config', themedPublic.bot?.theme === 'ember');

    const badTheme = await fetch(`${BASE}/api/bots/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ theme: 'neon-disco' }),
    });
    const afterBad = await (await fetch(`${BASE}/api/bots/${id}/public`)).json();
    check('an unknown theme is ignored, keeping the stored one', badTheme.ok && afterBad.bot?.theme === 'ember');
    check('Public config leaks no key fields', !JSON.stringify(pub).includes('apiKey'));

    // 5. streaming chat
    const chatRes = await fetch(`${BASE}/api/chat/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }),
    });
    const text = await chatRes.text();
    check('POST /api/chat streams a reply', chatRes.ok && text.includes('Echo:'), text.slice(0, 200));
    check('Creator API key is decrypted and forwarded', text.includes('[auth-ok]'));
    check('System prompt is built and sent', text.includes('[system-ok]'));
    check('User message reaches the model', text.includes('ping'));

    const emptyChat = await fetch(`${BASE}/api/chat/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });
    check('POST /api/chat rejects an empty conversation', emptyChat.status === 400);

    const missing = await fetch(`${BASE}/api/chat/does-not-exist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    check('POST /api/chat 404s for an unknown bot', missing.status === 404);

    // 5b. knowledge base: ingest, retrieve, cite
    const addText = await fetch(`${BASE}/api/bots/${id}/sources`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'text',
        title: 'Refund policy',
        text:
          'Refund policy. Customers may return any widget within 30 days of delivery for a full refund. ' +
          'Shipping costs are not refunded. To start a return, email returns@acme.test with the order number.',
      }),
    });
    const textSource = await addText.json();
    check('POST /sources indexes pasted text', addText.status === 201 && textSource.source?.chunkCount > 0, JSON.stringify(textSource).slice(0, 200));

    const addQa = await fetch(`${BASE}/api/bots/${id}/sources`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'qa',
        pairs: [{ q: 'How much is a widget?', a: 'A single widget costs $9.' }],
      }),
    });
    check('POST /sources indexes Q&A pairs', (await addQa.json()).source?.chunkCount === 1);

    const badUrl = await fetch(`${BASE}/api/bots/${id}/sources`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'url', url: 'http://169.254.169.254/latest/meta-data/' }),
    });
    check('POST /sources refuses a metadata-service URL', badUrl.status === 400);

    const listed = await (await fetch(`${BASE}/api/bots/${id}/sources`, { headers })).json();
    check('GET /sources lists both sources', listed.sources.length === 2);
    check('GET /sources reports chunk totals', listed.totals.chunks >= 2);
    check('GET /sources withholds the stored raw text', !JSON.stringify(listed).includes('rawText'));

    const otherOwner = await fetch(`${BASE}/api/bots/${id}/sources`, { headers: strangerHeaders });
    check('another owner cannot list sources', otherOwner.status === 403);

    // 5c. /api/extract: file to text, no account and no chatbot needed
    const extract = async (name, bytes) => {
      const form = new FormData();
      form.append('file', new File([new Uint8Array(bytes)], name));
      const res = await fetch(`${BASE}/api/extract`, { method: 'POST', body: form });
      return { status: res.status, json: await res.json() };
    };

    const extractTxt = await extract('hours.txt', Buffer.from('Support hours are 9 to 5.'));
    check(
      'POST /api/extract returns the text of a plain file',
      extractTxt.status === 200 && extractTxt.json.text === 'Support hours are 9 to 5.',
      JSON.stringify(extractTxt.json).slice(0, 200),
    );
    check('POST /api/extract needs no owner header', !JSON.stringify(extractTxt.json).includes('error'));

    if (canParsePdf()) {
      const extractPdf = await extract('policy.pdf', makePdf(['Returns within 30 days.', 'Free shipping over $50.']));
      check(
        'POST /api/extract reads a PDF text layer',
        extractPdf.status === 200 && extractPdf.json.text.includes('Free shipping over $50.'),
        JSON.stringify(extractPdf.json).slice(0, 200),
      );
      check('POST /api/extract marks the page number', extractPdf.json.text?.includes('[Page 1]'));

      const brokenPdf = await extract('broken.pdf', Buffer.from('%PDF-1.4 not really'));
      check('POST /api/extract rejects an unreadable PDF as a 400', brokenPdf.status === 400);
    } else {
      console.log(`  – PDF extraction skipped: needs Node >= 20.16, running ${process.versions.node}`);
    }

    const extractBad = await extract('logo.png', Buffer.from('nope'));
    check('POST /api/extract refuses an unsupported type', extractBad.status === 415);

    const extractEmpty = await extract('empty.txt', Buffer.alloc(0));
    check('POST /api/extract refuses an empty file', extractEmpty.status === 400);

    const extractJson = await fetch(`${BASE}/api/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    check('POST /api/extract refuses a non-multipart body', extractJson.status === 415);

    const grounded = await fetch(`${BASE}/api/chat/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'how do refunds work?' }] }),
    });
    const groundedText = await grounded.text();
    check('the retrieved excerpt reaches the model', groundedText.includes('30 days of delivery'));
    check('the response reports how many chunks were used', Number(grounded.headers.get('x-retrieval')) > 0);

    const citationsHeader = grounded.headers.get('x-citations');
    const citations = citationsHeader ? JSON.parse(Buffer.from(citationsHeader, 'base64').toString('utf8')) : [];
    check('citations come back with the answer', citations.length > 0);
    check('citations are numbered from 1', citations[0]?.n === 1);
    check('citations name their source', citations.some((c) => c.title === 'Refund policy'));
    check('citations carry a snippet', Boolean(citations[0]?.snippet));
    check('CORS exposes the citation header', (grounded.headers.get('access-control-expose-headers') ?? '').includes('X-Citations'));

    // Retrieval must pick the right source, not just any source.
    const priceAsk = await fetch(`${BASE}/api/chat/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'how much does a widget cost?' }] }),
    });
    const priceText = await priceAsk.text();
    const firstExcerpt = priceText.split('[1]')[1]?.slice(0, 300) ?? '';
    check('retrieval ranks the relevant source first', firstExcerpt.includes('costs $9'), firstExcerpt.slice(0, 120));
    check('embeddings were stored and used', textSource.source?.chunkCount > 0 && !textSource.warning);

    const deleteSource = await fetch(`${BASE}/api/bots/${id}/sources/${textSource.source.id}`, {
      method: 'DELETE',
      headers,
    });
    check('DELETE /sources/:sourceId removes a source', deleteSource.ok);
    const afterDelete = await (await fetch(`${BASE}/api/bots/${id}/sources`, { headers })).json();
    check('the deleted source is gone', afterDelete.sources.length === 1);

    const afterDeleteChat = await fetch(`${BASE}/api/chat/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'how do refunds work?' }] }),
    });
    const afterDeleteText = await afterDeleteChat.text();
    check('deleted content no longer reaches the model', !afterDeleteText.includes('30 days of delivery'));

    // 5c. malformed input must be a 400, not a 500 with internals in it
    const badBodies = [
      ['POST', `${BASE}/api/bots`, 'null'],
      ['POST', `${BASE}/api/bots`, '[]'],
      ['POST', `${BASE}/api/bots`, '{oops'],
      ['PATCH', `${BASE}/api/bots/${id}`, 'null'],
      ['PATCH', `${BASE}/api/bots/${id}`, '{oops'],
      ['POST', `${BASE}/api/bots/${id}/sources`, 'null'],
      ['POST', `${BASE}/api/bots/${id}/sources`, '{oops'],
    ];
    let allFourHundred = true;
    let worstStatus = '';
    for (const [method, url, payload] of badBodies) {
      const res = await fetch(url, { method, headers, body: payload });
      if (res.status !== 400) {
        allFourHundred = false;
        worstStatus = `${method} ${url.replace(BASE, '')} with ${payload} -> ${res.status}`;
      }
      await res.text();
    }
    check('malformed bodies return 400, never 500', allFourHundred, worstStatus);

    const badChat = await fetch(`${BASE}/api/chat/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });
    check('a null chat body returns 400', badChat.status === 400);

    // 6. delivery surfaces
    const chatPage = await fetch(`${BASE}/chat/${id}`);
    const chatHtml = await chatPage.text();
    check('GET /chat/:id renders the hosted page', chatPage.ok && chatHtml.includes('Hello from the smoke test'));

    const embedPage = await fetch(`${BASE}/embed/${id}`);
    check('GET /embed/:id renders the iframe view', embedPage.ok);
    check(
      'Embed route allows framing from any site',
      (embedPage.headers.get('content-security-policy') || '').includes('frame-ancestors *'),
    );

    const widget = await fetch(`${BASE}/widget.js`);
    const widgetJs = await widget.text();
    check('GET /widget.js serves the loader', widget.ok && widgetJs.includes('data-bot-id'));

    // 7. domain lock
    await fetch(`${BASE}/api/bots/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ allowedOrigins: ['acme.com'] }),
    });
    const blocked = await fetch(`${BASE}/api/chat/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    check('Allowed-domains list blocks other origins', blocked.status === 403);
    const allowed = await fetch(`${BASE}/api/chat/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://acme.com' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    check('Allowed-domains list permits the listed origin', allowed.ok);
    await allowed.text();

    // A missing Origin used to skip the check entirely, making the allow-list
    // advisory: any script could call the endpoint and spend the creator's credits.
    const noOrigin = await fetch(`${BASE}/api/chat/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    check('Allowed-domains list blocks a request with no Origin', noOrigin.status === 403);

    const selfOrigin = await fetch(`${BASE}/api/chat/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    check('the hosted chat page still works with a list set', selfOrigin.ok);
    await selfOrigin.text();

    // The iframe embed is served from this app, so its Origin is ours. The
    // framing page is reported separately and is what the list applies to.
    const embedOnEvil = await fetch(`${BASE}/api/chat/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE, 'X-Embed-Origin': 'https://evil.example' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    check('an embed on a disallowed site is blocked', embedOnEvil.status === 403);

    const embedOnAcme = await fetch(`${BASE}/api/chat/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE, 'X-Embed-Origin': 'https://acme.com' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    check('an embed on an allowed site passes', embedOnAcme.ok);
    await embedOnAcme.text();

    // 8. pause
    await fetch(`${BASE}/api/bots/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ isPublic: false, allowedOrigins: [] }),
    });
    const paused = await fetch(`${BASE}/api/chat/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    check('Paused bot refuses to answer', paused.status === 403);

    // 9. key survives an edit that omits it
    const afterEdit = await (await fetch(`${BASE}/api/bots/${id}`, { headers })).json();
    check('Editing without an API key keeps the stored one', afterEdit.hasKey === true);

    // 10. delete
    const del = await fetch(`${BASE}/api/bots/${id}`, { method: 'DELETE', headers });
    check('DELETE /api/bots/:id removes it', del.ok);
    const gone = await fetch(`${BASE}/api/bots/${id}/public`);
    check('Deleted bot is no longer public', gone.status === 404);

    // 11. anonymous draft funnel: build without an account, keys walled off,
    // signup claims the drafts.
    const anonHeaders = { 'Content-Type': 'application/json', 'x-owner-id': 'anon-draft-owner-1234567890' };
    const draftBody = {
      name: 'Draft Bot',
      info: 'Draft knowledge.',
      style: 'concise',
      provider: 'custom',
      customBaseUrl: `http://127.0.0.1:${MODEL_PORT}/v1`,
      model: 'fake-model-1',
      greeting: 'Draft greeting',
      accent: '#6366f1',
      theme: 'light',
    };

    const draftRes = await fetch(`${BASE}/api/bots`, { method: 'POST', headers: anonHeaders, body: JSON.stringify(draftBody) });
    const draft = await draftRes.json();
    check('anonymous browser can create a draft bot', draftRes.status === 201 && draft.bot?.id, JSON.stringify(draft).slice(0, 200));
    const draftId = draft.bot?.id;

    const keyedDraft = await fetch(`${BASE}/api/bots`, {
      method: 'POST',
      headers: anonHeaders,
      body: JSON.stringify({ ...draftBody, apiKey: 'sneaky-key-12345' }),
    });
    check('anonymous create with an API key is refused', keyedDraft.status === 403);

    const keyPatch = await fetch(`${BASE}/api/bots/${draftId}`, {
      method: 'PATCH',
      headers: anonHeaders,
      body: JSON.stringify({ apiKey: 'sneaky-key-12345' }),
    });
    check('anonymous PATCH with an API key is refused', keyPatch.status === 403);

    const anonUpload = await fetch(`${BASE}/api/bots/${draftId}/sources`, {
      method: 'POST',
      headers: anonHeaders,
      body: JSON.stringify({ type: 'text', title: 'T', text: 'Some text to index.' }),
    });
    check('anonymous source upload is refused', anonUpload.status === 403);

    const draftChat = await fetch(`${BASE}/api/chat/${draftId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'ping draft' }] }),
    });
    const draftChatText = await draftChat.text();
    check('a draft bot can chat before signup', draftChat.ok && draftChatText.includes('Echo:'), draftChatText.slice(0, 200));

    const claimRes = await fetch(`${BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'claimer@example.test',
        password: 'claim-password-1',
        ownerId: 'anon-draft-owner-1234567890',
      }),
    });
    const claimSession = (claimRes.headers.get('set-cookie') ?? '').match(/cf_session=[^;]+/)?.[0] ?? '';
    const claimHeaders = { 'Content-Type': 'application/json', cookie: claimSession };
    const claimed = await (await fetch(`${BASE}/api/bots`, { headers: claimHeaders })).json();
    check('signup claims the anonymous drafts', claimed.bots?.some((b) => b.id === draftId), JSON.stringify(claimed).slice(0, 200));

    const keyAfterClaim = await fetch(`${BASE}/api/bots/${draftId}`, {
      method: 'PATCH',
      headers: claimHeaders,
      body: JSON.stringify({ apiKey: 'real-key-after-claim' }),
    });
    check('the claimed bot can now store an API key', keyAfterClaim.ok);
    const claimedBot = await (await fetch(`${BASE}/api/bots/${draftId}`, { headers: claimHeaders })).json();
    check('the stored key survives the claim', claimedBot.hasKey === true);

    const strangerAfterClaim = await fetch(`${BASE}/api/bots/${draftId}`, { headers: anonHeaders });
    check('the old browser id no longer owns a claimed bot', strangerAfterClaim.status === 403);

    await fetch(`${BASE}/api/bots/${draftId}`, { method: 'DELETE', headers: claimHeaders });

    /* ---------------- roles ---------------- */
    // smoke@example.test is the ADMIN_EMAIL root admin; `headers` carries it.
    const adminHeaders = { 'Content-Type': 'application/json', cookie: session };

    const plainRes = await fetch(`${BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'roles@example.test', password: 'roles-password-1' }),
    });
    const plainSession = (plainRes.headers.get('set-cookie') ?? '').match(/cf_session=[^;]+/)?.[0] ?? '';
    const plainHeaders = { 'Content-Type': 'application/json', cookie: plainSession };

    const overviewAsRoot = await fetch(`${BASE}/api/admin/overview`, { headers: adminHeaders });
    check('the root admin can read the overview', overviewAsRoot.ok);

    const beforePromotion = await fetch(`${BASE}/api/admin/overview`, { headers: plainHeaders });
    check('a plain user gets 404 from the admin API', beforePromotion.status === 404);

    /* The /admin *page* has to answer the same way as the API behind it. It
       used to check only that some valid session existed, so any signed-in
       visitor could open it and read the heading — which gives away exactly
       what the API's 404 is there to hide. */
    const pageAsPlain = await fetch(`${BASE}/admin`, { headers: { cookie: plainSession } });
    check('a plain user gets 404 from the admin page', pageAsPlain.status === 404);

    const pageAsAnon = await fetch(`${BASE}/admin`);
    check('a signed-out visitor gets 404 from the admin page', pageAsAnon.status === 404);

    const pageAsRoot = await fetch(`${BASE}/admin`, { headers: { cookie: session } });
    check('the root admin can still open the admin page', pageAsRoot.ok);

    const setRole = (headers, email, role) =>
      fetch(`${BASE}/api/admin/users`, { method: 'PATCH', headers, body: JSON.stringify({ email, role }) });

    const promote = await setRole(adminHeaders, 'roles@example.test', 'admin');
    check('an admin can promote another account', promote.ok);

    const afterPromotion = await fetch(`${BASE}/api/admin/overview`, { headers: plainHeaders });
    check('the promoted account can now read the overview', afterPromotion.ok);

    const meAfter = await (await fetch(`${BASE}/api/auth/me`, { headers: plainHeaders })).json();
    check('the promoted account reports isAdmin', meAfter.user?.isAdmin === true, JSON.stringify(meAfter));

    const rolesInOverview = (await afterPromotion.json()).users ?? [];
    const rootRow = rolesInOverview.find((u) => u.email === 'smoke@example.test');
    check('the overview marks the root admin', rootRow?.isRoot === true, JSON.stringify(rootRow));

    const demoteRoot = await setRole(plainHeaders, 'smoke@example.test', 'user');
    check('the root admin cannot be demoted', demoteRoot.status === 400);

    const demoteSelf = await setRole(plainHeaders, 'roles@example.test', 'user');
    check('an admin cannot change their own role', demoteSelf.status === 400);

    const badRole = await setRole(adminHeaders, 'roles@example.test', 'superuser');
    check('an unknown role is refused', badRole.status === 400);

    const missingEmail = await setRole(adminHeaders, 'nobody@example.test', 'admin');
    check('promoting an unknown email is a 404', missingEmail.status === 404);

    const demote = await setRole(adminHeaders, 'roles@example.test', 'user');
    check('an admin can demote another account', demote.ok);

    const afterDemotion = await fetch(`${BASE}/api/admin/overview`, { headers: plainHeaders });
    check('the demoted account loses access again', afterDemotion.status === 404);

    const roleFromStranger = await setRole(
      { 'Content-Type': 'application/json' },
      'roles@example.test',
      'admin',
    );
    check('a logged-out caller gets 404 from the role API', roleFromStranger.status === 404);

    /* ---------------- platform keys ---------------- */
    const keysUrl = `${BASE}/api/admin/platform-keys`;

    const keysAsStranger = await fetch(keysUrl);
    check('a logged-out caller gets 404 from the platform-key API', keysAsStranger.status === 404);

    const keysAsPlain = await fetch(keysUrl, { headers: plainHeaders });
    check('a demoted account gets 404 from the platform-key API', keysAsPlain.status === 404);

    const keyList = await (await fetch(keysUrl, { headers: adminHeaders })).json();
    check('the key list covers every provider', keyList.providers?.length >= 4, JSON.stringify(keyList).slice(0, 200));
    check('no key is set to begin with', keyList.providers?.every((p) => p.mask === null));

    const saveKey = (provider, apiKey) =>
      fetch(keysUrl, { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ provider, apiKey }) });

    const savedKey = await saveKey('openai', 'sk-platform-abcdefghijklmnop-1234');
    const savedBody = await savedKey.json();
    check('an admin can store a platform key', savedKey.ok && Boolean(savedBody.mask), JSON.stringify(savedBody));
    check('the stored key comes back masked, never in full',
      !JSON.stringify(savedBody).includes('abcdefghijklmnop'), JSON.stringify(savedBody));

    const afterSave = await (await fetch(keysUrl, { headers: adminHeaders })).json();
    const openaiRow = afterSave.providers.find((p) => p.id === 'openai');
    check('the panel shows the mask and who set it', Boolean(openaiRow.mask) && openaiRow.updatedBy === 'smoke@example.test');
    check('listing never leaks the plaintext key', !JSON.stringify(afterSave).includes('abcdefghijklmnop'));

    const badProvider = await saveKey('not-a-provider', 'sk-whatever');
    check('an unknown provider is refused', badProvider.status === 400);
    const emptyKey = await saveKey('openai', '   ');
    check('an empty key is refused', emptyKey.status === 400);
    const hugeKey = await saveKey('openai', 'x'.repeat(500));
    check('an absurdly long key is refused', hugeKey.status === 400);

    const keyFromStranger = await fetch(keysUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', apiKey: 'sk-not-allowed' }),
    });
    check('a logged-out caller cannot store a key', keyFromStranger.status === 404);

    const removed = await fetch(`${keysUrl}?provider=openai`, { method: 'DELETE', headers: adminHeaders });
    check('an admin can remove a platform key', removed.ok);
    const removedTwice = await fetch(`${keysUrl}?provider=openai`, { method: 'DELETE', headers: adminHeaders });
    check('removing a key that is not there is a 404', removedTwice.status === 404);

    const afterRemove = await (await fetch(keysUrl, { headers: adminHeaders })).json();
    check('the removed key is gone from the list',
      afterRemove.providers.find((p) => p.id === 'openai').mask === null);

    /* ---------------- key requests ---------------- */
    // The third door out of the model step: a creator with no key and no
    // credits asks the admin instead of being stuck. `plainHeaders` is a
    // demoted, ordinary account by this point, which is exactly the caller.
    const reqUrl = `${BASE}/api/key-requests`;
    const adminReqUrl = `${BASE}/api/admin/key-requests`;

    const askAsStranger = await fetch(reqUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', reason: 'no account here' }),
    });
    check('a logged-out caller cannot ask for a key', askAsStranger.status === 401);

    const asked = await fetch(reqUrl, {
      method: 'POST',
      headers: plainHeaders,
      body: JSON.stringify({ provider: 'openai', model: 'gpt-4o-mini', reason: 'support bot for my shop' }),
    });
    check('a logged-in account can ask for a key', asked.status === 201);

    const askedTwice = await fetch(reqUrl, {
      method: 'POST',
      headers: plainHeaders,
      body: JSON.stringify({ provider: 'openai', reason: 'nudging' }),
    });
    check('a second request for the same provider is refused', askedTwice.status === 409);

    const askedBlank = await fetch(reqUrl, {
      method: 'POST',
      headers: plainHeaders,
      body: JSON.stringify({ provider: 'groq', reason: '   ' }),
    });
    check('a request with no note is refused', askedBlank.status === 400);

    const adminListAsStranger = await fetch(adminReqUrl);
    check('a logged-out caller gets 404 from the key-request panel', adminListAsStranger.status === 404);
    const adminListAsPlain = await fetch(adminReqUrl, { headers: plainHeaders });
    check('the requester cannot read the panel either', adminListAsPlain.status === 404);

    const panel = await (await fetch(adminReqUrl, { headers: adminHeaders })).json();
    const filed = panel.requests?.find((r) => r.email === 'roles@example.test');
    check('the admin sees who requested', Boolean(filed), JSON.stringify(panel).slice(0, 200));
    check('and what they asked for', filed?.provider === 'openai' && filed?.model === 'gpt-4o-mini');
    check('and what they wrote', filed?.reason === 'support bot for my shop');
    check('the waiting count is shown', panel.pending === 1, String(panel.pending));
    check('the panel never carries the requester internal id', !JSON.stringify(panel).includes('userId'));

    const decideAsPlain = await fetch(adminReqUrl, {
      method: 'PATCH',
      headers: plainHeaders,
      body: JSON.stringify({ id: filed?.id, status: 'approved' }),
    });
    check('a non-admin cannot decide a request', decideAsPlain.status === 404);

    const decideBadStatus = await fetch(adminReqUrl, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ id: filed?.id, status: 'pending' }),
    });
    check('"pending" is not a decision', decideBadStatus.status === 400);

    const decided = await fetch(adminReqUrl, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ id: filed?.id, status: 'approved', note: 'granted 200 credits' }),
    });
    check('an admin can answer a request', decided.ok);

    const myRequests = await (await fetch(reqUrl, { headers: plainHeaders })).json();
    const answered = myRequests.requests?.find((r) => r.id === filed?.id);
    check('the requester sees the decision', answered?.status === 'approved', JSON.stringify(myRequests).slice(0, 200));
    check('and the reply that came with it', answered?.adminNote === 'granted 200 credits');
    check('and who made it', answered?.decidedBy === 'smoke@example.test');

    const afterDecision = await (await fetch(adminReqUrl, { headers: adminHeaders })).json();
    check('nothing is left waiting', afterDecision.pending === 0);

    /* --------- the credits tier actually spends the stored key --------- */
    // A bot with no key of its own, on an included model, pointed at the fake
    // provider. Its only possible funding is the platform key, so whether it
    // can talk is a direct test of the store.
    const tierBot = await (await fetch(`${BASE}/api/bots`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'Credits Tier Bot',
        info: 'Widgets cost $9.',
        provider: 'openai',
        model: 'gpt-4o-mini',
        customBaseUrl: `http://127.0.0.1:${MODEL_PORT}/v1`,
        greeting: 'hi',
      }),
    })).json();
    const tierId = tierBot.bot?.id;
    check('a keyless bot on an included model can be created', Boolean(tierId), JSON.stringify(tierBot).slice(0, 200));

    await fetch(`${BASE}/api/admin/credits`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ email: 'smoke@example.test', amount: 5 }),
    });

    const askTier = () =>
      fetch(`${BASE}/api/chat/${tierId}`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
      });

    // No platform key stored (it was just removed) -> the tier cannot fund it.
    const withoutKey = await askTier();
    const withoutKeyText = await withoutKey.text();
    check('with no platform key stored, the credits tier refuses',
      !withoutKey.ok && /platform|key/i.test(withoutKeyText), `${withoutKey.status} ${withoutKeyText.slice(0, 160)}`);

    await saveKey('openai', 'sk-platform-live-key-9876');

    const before = (await (await fetch(`${BASE}/api/auth/me`, { headers: adminHeaders })).json()).user?.credits;
    const withKey = await askTier();
    const withKeyText = await withKey.text();
    check('once a platform key is stored, the same bot can talk',
      withKey.ok && withKeyText.includes('Echo:'), `${withKey.status} ${withKeyText.slice(0, 160)}`);

    const after = (await (await fetch(`${BASE}/api/auth/me`, { headers: adminHeaders })).json()).user?.credits;
    check('the message spent exactly one credit', after === before - 1, `before=${before} after=${after}`);

    await fetch(`${keysUrl}?provider=openai`, { method: 'DELETE', headers: adminHeaders });
    await fetch(`${BASE}/api/bots/${tierId}`, { method: 'DELETE', headers: adminHeaders });

    // A provider's rejection quotes the key it rejected, in masked form. On the
    // creator's own key that is a useful diagnostic; on the platform's key it
    // hands a stranger the first and last characters of a live secret.
    await saveKey('openai', 'sk-platform-second-key-5555');
    const leakBot = await (await fetch(`${BASE}/api/bots`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'Leak Probe',
        provider: 'openai',
        // The sentinel model the fake provider always rejects.
        model: 'gpt-4.1-mini',
        greeting: 'hi',
      }),
    })).json();
    await fetch(`${BASE}/api/admin/credits`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ email: 'smoke@example.test', amount: 3 }),
    });
    const failing = await fetch(`${BASE}/api/chat/${leakBot.bot?.id}`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    const failingText = await failing.text();
    check('the upstream call really did fail', !failing.ok, `${failing.status}`);
    check('an upstream failure on a platform key never quotes the key',
      !/sk-platform/i.test(failingText), failingText.slice(0, 160));
    check('the visitor gets a usable message instead',
      /could not reach the model/i.test(failingText), failingText.slice(0, 160));
    await fetch(`${keysUrl}?provider=openai`, { method: 'DELETE', headers: adminHeaders });
    await fetch(`${BASE}/api/bots/${leakBot.bot?.id}`, { method: 'DELETE', headers: adminHeaders });

    /* ---------------- account recovery ---------------- */
    console.log('\nPassword reset');

    const forgot = (email) =>
      fetch(`${BASE}/api/auth/forgot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

    const known = await forgot('smoke@example.test');
    const unknown = await forgot('nobody-here@example.test');
    const knownBody = await known.json();
    const unknownBody = await unknown.json();
    // The whole point: the endpoint must not become a way to find out which
    // addresses have accounts.
    check('a reset request for a real account succeeds', known.ok);
    check('a reset request for an unknown address looks identical',
      unknown.ok && unknownBody.message === knownBody.message,
      JSON.stringify({ knownBody, unknownBody }).slice(0, 200));
    check('an invalid address is rejected', !(await forgot('not-an-email')).ok);

    const badReset = await fetch(`${BASE}/api/auth/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'a'.repeat(43), password: 'a-new-password' }),
    });
    check('a made-up reset token is refused', badReset.status === 400);

    const shortPassword = await fetch(`${BASE}/api/auth/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'a'.repeat(43), password: 'short' }),
    });
    check('a too-short password is refused before the token is spent', shortPassword.status === 400);

    check('a made-up verification token is refused', (await fetch(`${BASE}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'b'.repeat(43) }),
    })).status === 400);

    /* ---------------- billing ---------------- */
    console.log('\nBilling');

    const packs = await (await fetch(`${BASE}/api/billing/checkout`)).json();
    check('the credit packs are listed', Array.isArray(packs.packs) && packs.packs.length > 0);
    check('buying is reported as off without Stripe configured', packs.enabled === false);

    const checkoutAnon = await fetch(`${BASE}/api/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId: packs.packs[0]?.id }),
    });
    check('checkout is refused when Stripe is not configured', checkoutAnon.status === 503);

    // The webhook is the only route that turns money into credits, so an
    // unsigned call to it must go nowhere.
    const creditsBeforeForgery = (await (await fetch(`${BASE}/api/auth/me`, { headers: adminHeaders })).json()).user
      ?.credits;
    const unsignedHook = await fetch(`${BASE}/api/billing/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'evt_forged',
        type: 'checkout.session.completed',
        data: { object: { payment_status: 'paid', metadata: { userId: 'anyone', credits: '999999' } } },
      }),
    });
    check('an unsigned webhook is rejected', unsignedHook.status === 400);

    const creditsAfterForgery = (await (await fetch(`${BASE}/api/auth/me`, { headers: adminHeaders })).json()).user
      ?.credits;
    check('the forged webhook granted nothing', creditsAfterForgery === creditsBeforeForgery,
      `before=${creditsBeforeForgery} after=${creditsAfterForgery}`);

    const history = await (await fetch(`${BASE}/api/billing/history`, { headers: adminHeaders })).json();
    check('the credit ledger is readable by its owner', Array.isArray(history.entries));
    check('the ledger recorded the admin grant and the spend',
      history.entries.some((e) => e.reason === 'admin-grant') && history.entries.some((e) => e.reason === 'spend'),
      JSON.stringify(history.entries).slice(0, 200));
    check('the ledger is private', (await fetch(`${BASE}/api/billing/history`)).status === 401);

    /* ---------------- account data ---------------- */
    console.log('\nAccount data');

    const exported = await fetch(`${BASE}/api/auth/account`, { headers: adminHeaders });
    const exportBody = await exported.json();
    check('an account can export its own data', exported.ok && exportBody.account?.email === 'smoke@example.test');
    check('the export never carries stored API keys',
      !JSON.stringify(exportBody).includes('apiKeyEnc'));
    check('an export needs a session', (await fetch(`${BASE}/api/auth/account`)).status === 401);

    const wrongPassword = await fetch(`${BASE}/api/auth/account`, {
      method: 'DELETE',
      headers: adminHeaders,
      body: JSON.stringify({ password: 'not-the-password' }),
    });
    check('deleting an account needs the right password', wrongPassword.status === 403);
  } finally {
    await cleanup();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error('\nSmoke test crashed:', e);
  process.exit(1);
});
