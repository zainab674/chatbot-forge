/**
 * The site's own absolute URL, for the places that cannot ask a request for it.
 *
 * `appUrl()` in lib/mail.ts is the request-aware version and deliberately
 * returns null in production when NEXT_PUBLIC_APP_URL is unset — a reset link
 * built from an attacker-supplied Host header is a real attack, so it refuses
 * to guess. Metadata has no such exposure: the worst a wrong value does here is
 * an og:image that fails to load, and returning null instead would mean no
 * canonical URL and no sitemap at all.
 *
 * So this one falls back, and the fallback is the deployed origin.
 */
const FALLBACK = 'https://chatbot-forge-144.netlify.app';

export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '');
  return configured || FALLBACK;
}
