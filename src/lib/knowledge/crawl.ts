/**
 * Fetching web pages for the knowledge base.
 *
 * Two entry points: a single URL (optionally following same-origin links one
 * level deep) and a sitemap.xml. Both are bounded, because a creator pasting
 * their homepage should not be able to pull a thousand pages into the request.
 *
 * Every outbound request goes through `safeFetch`, which is the only place
 * allowed to call `fetch` in this module. It validates the URL, resolves DNS
 * and checks the actual IP, follows redirects manually so each hop is
 * re-validated, and caps the response body while it streams.
 */
import { pinnedFetch } from '../net-guard';
import { htmlToText, extractTitle, extractLinks, extractSitemapUrls } from './html';

export interface Page {
  url: string;
  title: string;
  text: string;
}

export interface CrawlOptions {
  maxPages?: number;
  /** Follow same-origin links found on the first page. */
  followLinks?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Absolute time (Date.now()) to stop fetching more pages.
   *
   * Serverless hosts kill a function at a fixed wall clock (60 seconds on
   * Netlify, and it cannot be raised), so a large sitemap would otherwise be
   * cut off with nothing saved. Stopping early keeps whatever was fetched.
   */
  deadline?: number;
}

const UA = 'ChatbotForge/1.0 (+knowledge-base indexer)';
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

/* ------------------------------------------------------------------ */
/* Safe fetching                                                        */
/* ------------------------------------------------------------------ */

interface FetchResult {
  url: string;
  body: string;
  contentType: string;
}

/**
 * The only fetch in this file.
 *
 * Redirects are followed by hand because the allow-list is worthless otherwise:
 * a public URL that 302s to 127.0.0.1 would pull an internal page into
 * someone's chatbot. Each hop is re-validated, DNS is resolved so a public
 * hostname pointing at a private address (the classic `127.0.0.1.nip.io` trick)
 * is rejected too — and `pinnedFetch` then connects to the very address that
 * was checked, so the name cannot resolve to something else in between.
 */
export async function safeFetch(
  rawUrl: string,
  opts: { timeoutMs?: number; signal?: AbortSignal; maxBytes?: number } = {},
): Promise<FetchResult> {
  const { timeoutMs = 15_000, signal, maxBytes = MAX_HTML_BYTES } = opts;

  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);

    try {
      // Validates and connects in one step, so nothing can change underneath.
      const res = await pinnedFetch(current, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        },
        signal: controller.signal,
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        res.body?.cancel().catch(() => {});
        if (!location) throw new Error(`Redirect with no destination (${res.status}).`);
        current = new URL(location, current).toString();
        continue;
      }

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const contentType = res.headers.get('content-type') ?? '';
      if (!/text\/html|text\/plain|application\/xhtml|application\/xml|text\/xml/i.test(contentType)) {
        res.body?.cancel().catch(() => {});
        throw new Error(`Unsupported content type "${contentType.split(';')[0] || 'unknown'}".`);
      }

      return { url: res.url || current, body: await readCapped(res, maxBytes), contentType };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  throw new Error(`Too many redirects (more than ${MAX_REDIRECTS}).`);
}

/**
 * Reads at most `maxBytes`, then stops pulling.
 *
 * `res.text()` would buffer the whole body first, so a multi-hundred-megabyte
 * response could exhaust memory long before any length check ran.
 */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes * 4) {
    res.body?.cancel().catch(() => {});
    throw new Error('That page is too large to index.');
  }

  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let out = '';
  let bytes = 0;

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      out += decoder.decode(value, { stream: true });
      if (bytes >= maxBytes) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return out + decoder.decode();
}

/* ------------------------------------------------------------------ */
/* Crawling                                                             */
/* ------------------------------------------------------------------ */

export async function fetchPage(url: string, timeoutMs = 15_000, signal?: AbortSignal): Promise<Page> {
  const res = await safeFetch(url, { timeoutMs, signal });
  const isMarkup = /html|xml/i.test(res.contentType);
  return {
    url: res.url,
    title:
      (isMarkup ? extractTitle(res.body) : '') ||
      new URL(res.url).pathname.replace(/^\//, '') ||
      new URL(res.url).hostname,
    text: isMarkup ? htmlToText(res.body) : res.body,
  };
}

/** True when there is no time left to fetch another page. */
function outOfTime(deadline?: number): boolean {
  return typeof deadline === 'number' && Date.now() >= deadline;
}

export async function crawlUrl(url: string, opts: CrawlOptions = {}): Promise<Page[]> {
  const { maxPages = 1, followLinks = false, timeoutMs = 15_000, signal, deadline } = opts;

  const res = await safeFetch(url, { timeoutMs, signal });
  const first: Page = {
    url: res.url,
    title: extractTitle(res.body) || new URL(res.url).hostname,
    text: htmlToText(res.body),
  };
  const pages: Page[] = [first];
  if (!followLinks || maxPages <= 1) return pages;

  const seen = new Set([normalise(first.url), normalise(url)]);
  const queue = extractLinks(res.body, first.url).filter((l) => !seen.has(normalise(l)));

  for (const next of queue) {
    if (pages.length >= maxPages || outOfTime(deadline)) break;
    if (seen.has(normalise(next))) continue;
    seen.add(normalise(next));
    try {
      const page = await fetchPage(next, timeoutMs, signal);
      if (page.text.trim().length > 200) pages.push(page);
    } catch {
      // One dead link should not fail the whole source.
    }
  }
  return pages;
}

export async function crawlSitemap(url: string, opts: CrawlOptions = {}): Promise<Page[]> {
  const { maxPages = 25, timeoutMs = 15_000, signal, deadline } = opts;

  const root = await safeFetch(url, { timeoutMs, signal });
  let urls = extractSitemapUrls(root.body);
  if (!urls.length) throw new Error('No <loc> entries found. Is that really a sitemap.xml?');

  // A sitemap index points at more sitemaps; follow the first few. These go
  // through safeFetch as well, so a hostile sitemap cannot smuggle in a
  // loopback URL.
  const nested = urls.filter((u) => /\.xml(\?|$)/i.test(u));
  if (nested.length && nested.length === urls.length) {
    const expanded: string[] = [];
    for (const child of nested.slice(0, 5)) {
      try {
        const res = await safeFetch(child, { timeoutMs, signal });
        expanded.push(...extractSitemapUrls(res.body));
      } catch {
        // Skip unreachable or disallowed child sitemaps.
      }
      if (expanded.length >= maxPages || outOfTime(deadline)) break;
    }
    if (expanded.length) urls = expanded;
  }

  const pages: Page[] = [];
  for (const pageUrl of urls.filter((u) => !/\.xml(\?|$)/i.test(u)).slice(0, maxPages)) {
    // Stop while there is still time to embed and store what has been fetched.
    if (outOfTime(deadline)) break;
    try {
      const page = await fetchPage(pageUrl, timeoutMs, signal);
      if (page.text.trim().length > 200) pages.push(page);
    } catch {
      // Skip unreachable pages.
    }
  }
  if (!pages.length) throw new Error('None of the sitemap URLs returned readable text.');
  return pages;
}

function normalise(u: string): string {
  try {
    const parsed = new URL(u);
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return u;
  }
}


/* ------------------------------------------------------------------ */
/* SSRF protection                                                      */
/* ------------------------------------------------------------------ */

// Lives in lib/net-guard.ts now: the chat path needs the same checks for a
// bot's custom endpoint, and one copy of these rules is the only safe number.
export { isPrivateIp, assertPublicUrl, assertReachableUrl, pinnedFetch } from '../net-guard';
