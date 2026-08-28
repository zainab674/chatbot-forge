import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Pack } from './packs';
import { CURRENCY } from './packs';

/**
 * Stripe, over its REST API.
 *
 * No SDK: checkout is one form-encoded POST and the webhook signature is an
 * HMAC, so the dependency would buy nothing but a supply chain to watch. The
 * two things that genuinely need care — signature verification and idempotency
 * — are done here and in `grantCredits` respectively.
 *
 * Unconfigured is a supported state. Without STRIPE_SECRET_KEY the buy buttons
 * do not appear and top-ups stay manual through /admin, which is how this ran
 * before payments existed.
 */

const API = 'https://api.stripe.com/v1';

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function webhookConfigured(): boolean {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}

/**
 * Stripe takes nested parameters as `a[b][c]=v`, not JSON.
 */
function form(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

export interface CheckoutArgs {
  pack: Pack;
  userId: string;
  email: string;
  /** Absolute base URL to return the customer to. */
  origin: string;
}

/**
 * Creates a Checkout session and returns the URL to send the customer to.
 *
 * `client_reference_id` and the metadata carry the account id through Stripe
 * and back on the webhook, which is how a payment is attached to a balance.
 * The customer's email is prefilled but the account id is what is trusted —
 * someone can type any address into Stripe's form.
 */
export async function createCheckoutSession(a: CheckoutArgs): Promise<{ url: string; id: string }> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe is not configured.');

  const body = form({
    mode: 'payment',
    success_url: `${a.origin}/account?purchase=success`,
    cancel_url: `${a.origin}/account?purchase=cancelled`,
    client_reference_id: a.userId,
    customer_email: a.email,
    'metadata[userId]': a.userId,
    'metadata[packId]': a.pack.id,
    'metadata[credits]': a.pack.credits,
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': CURRENCY,
    'line_items[0][price_data][unit_amount]': a.pack.amount,
    'line_items[0][price_data][product_data][name]': `${a.pack.credits.toLocaleString('en')} Chatbot Forge credits`,
    'line_items[0][price_data][product_data][description]': a.pack.note,
  });

  const res = await fetch(`${API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (json as any)?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Stripe rejected the checkout session: ${detail}`);
  }
  if (!(json as any)?.url) throw new Error('Stripe returned no checkout URL.');
  return { url: (json as any).url, id: (json as any).id };
}

/* ------------------------------------------------------------------ */
/* Webhook signatures                                                   */
/* ------------------------------------------------------------------ */

/** Stripe rejects timestamps older than this, and so does this. */
const TOLERANCE_SEC = 300;

/**
 * Verifies a `Stripe-Signature` header against the raw request body.
 *
 * This is the only thing standing between the webhook and anyone who can guess
 * its URL, and the endpoint grants credits — so it fails closed on every
 * unexpected shape, and the comparison is constant-time. The body must be the
 * exact bytes Stripe sent: parsing and re-serialising the JSON changes the
 * signature and everything stops working.
 */
export function verifyWebhookSignature(
  payload: string,
  header: string | null,
  secret: string | undefined,
  now = Date.now(),
): { ok: boolean; error?: string } {
  if (!secret) return { ok: false, error: 'No STRIPE_WEBHOOK_SECRET configured.' };
  if (!header) return { ok: false, error: 'No signature header.' };

  const parts = header.split(',').map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2) ?? '';
  const signatures = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));

  const t = parseInt(timestamp, 10);
  if (!Number.isFinite(t)) return { ok: false, error: 'Malformed signature header.' };
  if (!signatures.length) return { ok: false, error: 'No v1 signature in header.' };

  // A replayed request with a valid old signature would otherwise be accepted
  // forever; the event id makes the grant idempotent, but the window is still
  // worth closing.
  if (Math.abs(now / 1000 - t) > TOLERANCE_SEC) return { ok: false, error: 'Signature timestamp is too old.' };

  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const expectedBuf = Buffer.from(expected);
  const matched = signatures.some((sig) => {
    const actual = Buffer.from(sig);
    return actual.length === expectedBuf.length && timingSafeEqual(actual, expectedBuf);
  });

  return matched ? { ok: true } : { ok: false, error: 'Signature does not match.' };
}
