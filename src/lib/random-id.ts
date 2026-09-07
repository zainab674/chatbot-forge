'use client';

/**
 * A 32-character random id for the browser.
 *
 * `crypto.randomUUID` exists only in a secure context. A widget embedded on a
 * customer's plain-http site is exactly where this code ends up, and calling it
 * unguarded there throws a TypeError that takes the caller down with it — which
 * is how the dashboard used to break on any deployment not served over HTTPS.
 *
 * `getRandomValues` has no such restriction and covers that case properly. The
 * `Math.random` tail is genuine last resort: it should be unreachable in any
 * real browser, and it exists so that this function cannot throw. It still
 * returns a full 32 characters, unlike the one-shot `Math.random` fallback it
 * replaces — that produced about eleven random characters padded out with
 * zeroes, which cleared the server's length check while carrying nowhere near
 * the entropy the check was standing in for.
 */
export function randomId(): string {
  const source = typeof crypto !== 'undefined' ? crypto : undefined;
  if (source?.randomUUID) return source.randomUUID().replace(/-/g, '');
  if (source?.getRandomValues) {
    const bytes = source.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let out = '';
  while (out.length < 32) out += Math.random().toString(36).slice(2);
  return out.slice(0, 32);
}
