/**
 * HTML to readable text.
 *
 * Deliberately dependency-free: strips the parts of a page nobody wants in a
 * knowledge base (nav, script, style, cookie banners), keeps block structure so
 * the chunker still sees paragraph boundaries, and decodes the handful of
 * entities that actually show up in prose.
 */

const DROP_BLOCKS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  // The page title is read separately; leaving it in duplicates it in the body.
  'title',
];

/** List rows and table rows: one line each, not one paragraph each. */
const ITEM_OPEN = /<(li|dd|dt|tr)\b[^>]*>/gi;
const ITEM_CLOSE = /<\/(li|dd|dt|tr)\s*>/gi;
/** Cells stay on the same line as their row, separated by a pipe. */
const CELL_OPEN = /<(td|th)\b[^>]*>/gi;
const CELL_CLOSE = /<\/(td|th)\s*>/gi;

const BLOCK_TAGS =
  /<\/?(p|div|section|article|main|br|hr|ul|ol|dl|table|thead|tbody|h[1-6]|blockquote|pre|figure|figcaption)[^>]*>/gi;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  times: '×',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  eacute: 'é',
  deg: '°',
  euro: '€',
  pound: '£',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => safeChar(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 9 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Page <title>, used as the citation label. */
export function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) return decodeEntities(og[1]).trim();
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return t?.[1] ? decodeEntities(t[1]).replace(/\s+/g, ' ').trim() : '';
}

/**
 * Removes HTML comments by scanning, not by regex.
 *
 * The obvious `/<!--[\s\S]*?-->/g` is quadratic on input containing many
 * unterminated `<!--`: every one of them rescans the rest of the document.
 * A 256KB page of those takes over 20 seconds and blocks the event loop, so a
 * single uploaded file could freeze the server. Scanning is linear.
 *
 * Follows the HTML5 comment rules rather than just looking for `-->`, because
 * `<!-->` and `<!--->` are complete (empty) comments and `--!>` is a legal
 * close. Treating those as unterminated would silently truncate a page to its
 * first few words.
 */
function stripComments(input: string): string {
  let out = '';
  let cursor = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const start = input.indexOf('<!--', cursor);
    if (start === -1) break;
    out += input.slice(cursor, start) + ' ';

    const afterOpen = start + 4;
    // <!--> and <!---> are empty comments, closed immediately.
    if (input.startsWith('>', afterOpen)) {
      cursor = afterOpen + 1;
      continue;
    }
    if (input.startsWith('->', afterOpen)) {
      cursor = afterOpen + 2;
      continue;
    }

    const standard = input.indexOf('-->', afterOpen);
    const bang = input.indexOf('--!>', afterOpen);
    let end = -1;
    let width = 0;
    if (standard !== -1 && (bang === -1 || standard <= bang)) {
      end = standard;
      width = 3;
    } else if (bang !== -1) {
      end = bang;
      width = 4;
    }

    if (end === -1) {
      // Unterminated: drop the remainder, which is what a browser does too.
      return out;
    }
    cursor = end + width;
  }
  return out + input.slice(cursor);
}

/** Drops `<tag ...>...</tag>` and any stray opening tags of the same name. */
function dropElement(input: string, tag: string): string {
  let out = '';
  let cursor = 0;
  const lower = input.toLowerCase();
  const closing = `</${tag}`;
  // Once no closing tag exists after some position, none exists after any later
  // position either. Without this the "unclosed tag" path re-scans the rest of
  // the document for every opening tag, which is quadratic on hostile input.
  let noMoreClosing = false;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const start = findTagStart(lower, tag, cursor);
    if (start === -1) break;
    const openEnd = input.indexOf('>', start);
    if (openEnd === -1) return out + input.slice(cursor, start) + ' ';

    out += input.slice(cursor, start) + ' ';

    const closeStart = noMoreClosing ? -1 : lower.indexOf(closing, openEnd);
    if (closeStart === -1) {
      // No closing tag: skip just the opening tag, keep the rest of the page.
      noMoreClosing = true;
      cursor = openEnd + 1;
      continue;
    }
    const closeEnd = input.indexOf('>', closeStart);
    cursor = closeEnd === -1 ? input.length : closeEnd + 1;
  }
  return out + input.slice(cursor);
}

/** Index of `<tag` where the next character is a real tag-name boundary. */
function findTagStart(lower: string, tag: string, from: number): number {
  const needle = `<${tag}`;
  let i = from;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const at = lower.indexOf(needle, i);
    if (at === -1) return -1;
    const after = lower[at + needle.length];
    if (after === undefined || after === '>' || after === '/' || /\s/.test(after)) return at;
    i = at + needle.length;
  }
}

export function htmlToText(html: string): string {
  let s = html;

  // Script and style bodies go first: their contents are not markup, and a
  // string like `var open = '<!--'` inside one would otherwise look like an
  // unterminated comment and swallow the rest of the page.
  for (const tag of DROP_BLOCKS) {
    s = dropElement(s, tag);
  }

  s = stripComments(s);
  s = s.replace(/<!doctype[^>]*>/gi, ' ');

  // A commented-out block only becomes visible once its comment is gone, so
  // sweep again now that the comments have been removed.
  for (const tag of DROP_BLOCKS) {
    s = dropElement(s, tag);
  }

  // Rows first, so a list becomes a block of lines rather than a run of
  // one-line paragraphs, which chunks and embeds much better.
  s = s.replace(CELL_OPEN, '').replace(CELL_CLOSE, ' | ').replace(ITEM_OPEN, '').replace(ITEM_CLOSE, '\n');

  // Everything else that implies a paragraph break.
  s = s.replace(BLOCK_TAGS, '\n\n');

  // Everything else that is still a tag goes away.
  s = s.replace(/<[^>]+>/g, ' ');

  s = decodeEntities(s);

  return s
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    // Strip the cell separator left dangling by the last <td> of each row.
    .map((line) => line.replace(/^\s*\|\s*/, '').replace(/\s*\|\s*$/, '').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Same-origin links, used when crawling a URL a level deep. */
export function extractLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  const baseUrl = new URL(base);
  while ((m = re.exec(html))) {
    try {
      const u = new URL(decodeEntities(m[1]), base);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      if (u.hostname !== baseUrl.hostname) continue;
      if (/\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|mp3|css|js|ico|woff2?)$/i.test(u.pathname)) continue;
      u.hash = '';
      out.add(u.toString());
    } catch {
      /* skip malformed hrefs */
    }
  }
  return [...out];
}

/** <loc> entries from a sitemap.xml, including sitemap indexes. */
export function extractSitemapUrls(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(decodeEntities(m[1]));
  return out;
}
