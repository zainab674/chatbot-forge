/**
 * SSRF protection for every outbound URL the app is told to fetch.
 *
 * Two callers rely on this: the knowledge-base crawler (a creator pastes a URL)
 * and the chat path (a creator saves a custom endpoint). Both take a string
 * from a user and hand it to `fetch`, which is the whole shape of an SSRF, so
 * the checks live in one place rather than being reimplemented per caller.
 */
import dns from 'node:dns/promises';

/**
 * Self-host escape hatch, and deliberately narrow.
 *
 * Someone running this on their own machine may legitimately point a bot at
 * http://localhost:11434/v1 (Ollama) or a box on their LAN — that is a model
 * endpoint they chose, and the request carries their own key or none.
 *
 * It does NOT loosen the crawler. "Fetch this URL into a knowledge base" is a
 * different act: it reads a page and hands the text back, so allowing internal
 * addresses there turns any bot into a window onto the private network. The
 * crawler always uses the strict variant below.
 */
function privateEndpointsAllowed(): boolean {
  return process.env.ALLOW_PRIVATE_ENDPOINTS === '1';
}

/** Private, loopback, link-local and other non-routable ranges. */
export function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) || // link-local, includes cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      a >= 224 // multicast and reserved
    );
  }

  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (v6 === '::1' || v6 === '::') return true;
  // IPv4-mapped (::ffff:127.0.0.1) is checked against the v4 rules.
  const mapped = v6.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIp(mapped[1]);
  if (/^(fc|fd)/.test(v6)) return true; // unique local
  if (/^fe[89ab]/.test(v6)) return true; // link-local
  return false;
}

/**
 * Syntactic checks only. Callers that actually fetch must use
 * `assertReachableUrl`, which additionally resolves DNS.
 */
export function assertPublicUrl(raw: string, allowPrivate = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('That is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs can be indexed.');
  }
  if (allowPrivate) return url;

  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    host.endsWith('.home.arpa')
  ) {
    throw new Error('Local addresses cannot be indexed.');
  }

  // Literal addresses. WHATWG URL already normalises 127.1, 0x7f.0.0.1 and
  // 2130706433 to dotted quads, so this covers those spellings too.
  const literal = host.replace(/^\[|\]$/g, '');
  if (/^[\d.]+$/.test(literal) || literal.includes(':')) {
    if (isPrivateIp(literal)) throw new Error('Private network addresses cannot be indexed.');
  }
  return url;
}

/**
 * Everything `assertPublicUrl` checks, plus the resolved address.
 *
 * A hostname like `127.0.0.1.nip.io` is perfectly public-looking and resolves
 * straight to loopback, so the string check alone is not enough.
 */
export async function assertReachableUrl(raw: string, allowPrivate = false): Promise<URL> {
  const url = assertPublicUrl(raw, allowPrivate);
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');

  // A literal address was already checked and needs no lookup.
  if (/^[\d.]+$/.test(host) || host.includes(':')) return url;

  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`Could not resolve ${host}.`);
  }
  if (!addresses.length) throw new Error(`Could not resolve ${host}.`);
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new Error(`${host} resolves to a private network address, which cannot be indexed.`);
    }
  }
  return url;
}

/**
 * The check for a model or embedding endpoint a creator configured.
 *
 * Same rules as `assertReachableUrl`, except that a self-hoster can opt into
 * private addresses with ALLOW_PRIVATE_ENDPOINTS=1 — see the note at the top of
 * this file for why that opt-in stops here and does not reach the crawler.
 */
export async function assertReachableEndpoint(raw: string): Promise<URL> {
  return assertReachableUrl(raw, privateEndpointsAllowed());
}
