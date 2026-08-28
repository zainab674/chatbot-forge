/**
 * Rate limiting.
 *
 * The counters live in MongoDB, not in this process. That is the whole point:
 * on Netlify (and any other serverless host) every request may land on a
 * different instance, and instances are recycled constantly, so a `Map` in
 * module scope limits nothing at all — it silently resets under exactly the
 * traffic it exists to stop. Anything that guards spend or guesses passwords
 * has to count somewhere shared.
 *
 * A fixed window per key rather than a token bucket: one atomic `$inc` with an
 * upsert is a single round trip and behaves identically on every Mongo version,
 * where a bucket needs either a read-modify-write race or an aggregation
 * pipeline. The cost is that a caller can spend the tail of one window and the
 * head of the next back to back; the limits below are set with that in mind.
 *
 * Two windows are checked on every message:
 *   - per bot and client, which stops one visitor hammering the widget
 *   - per bot overall, which is what actually protects the creator's credits,
 *     because a client identifier is spoofable and rotating it would otherwise
 *     sidestep the per-client limit entirely
 *
 * If Mongo is unreachable the local bucket below takes over, so a database
 * hiccup degrades the limiter instead of taking chat down with it.
 */
import { rateLimits } from './mongodb';

export interface Limit {
  /** Requests allowed per window. */
  max: number;
  /** Window length in seconds. */
  windowSec: number;
}

export const PER_CLIENT: Limit = { max: 20, windowSec: 60 };
export const PER_BOT: Limit = { max: 240, windowSec: 60 };
/** Login and signup: slow enough that guessing a password is hopeless. */
export const PER_AUTH: Limit = { max: 10, windowSec: 300 };
/** Anything that calls a model or parses a document on an anonymous request. */
export const PER_EXPENSIVE: Limit = { max: 10, windowSec: 60 };
/** Account-less bot creation, which is the cheapest thing to automate. */
export const PER_CREATE: Limit = { max: 15, windowSec: 600 };

export interface LimitResult {
  ok: boolean;
  retryAfter: number;
  scope?: string;
}

/* ------------------------------------------------------------------ */
/* Shared counter                                                       */
/* ------------------------------------------------------------------ */

/** Every instance derives the same boundary from the clock, without coordinating. */
function windowEndFor(limit: Limit, now: number): number {
  const windowMs = limit.windowSec * 1000;
  return Math.ceil((now + 1) / windowMs) * windowMs;
}

/**
 * Hands a request back to a window.
 *
 * Used when a later check rejects something an earlier one already charged for
 * — see `rateLimit`. `now` is passed in rather than read again so the refund
 * lands in the window the charge did, even if the boundary has since rolled.
 */
async function refund(key: string, limit: Limit, now: number): Promise<void> {
  try {
    const col = await rateLimits();
    await col.updateOne({ key: `${key}:${windowEndFor(limit, now)}` }, { $inc: { count: -1 } });
  } catch {
    // A refund that does not land costs the visitor one message, which is a
    // far better failure than a 500.
  }
}

/**
 * Spends one request against `key`.
 *
 * The upsert plus `$inc` is atomic, so concurrent requests on different
 * instances cannot both read the same count. `windowEnd` is derived from the
 * clock rather than stored per caller, which means every instance agrees on
 * where the window boundary is without coordinating.
 */
export async function consume(key: string, limit: Limit, now = Date.now()): Promise<LimitResult> {
  const windowMs = limit.windowSec * 1000;
  const windowEnd = windowEndFor(limit, now);
  const retryAfter = Math.max(1, Math.ceil((windowEnd - now) / 1000));

  try {
    const col = await rateLimits();
    const res = await col.findOneAndUpdate(
      { key: `${key}:${windowEnd}` },
      {
        $inc: { count: 1 },
        $setOnInsert: {
          windowEnd,
          // Kept a window past the boundary so a clock skew between instances
          // cannot expire a document that is still being counted against.
          expiresAt: new Date(windowEnd + windowMs),
        },
      },
      { upsert: true, returnDocument: 'after' },
    );

    const count = (res as any)?.value?.count ?? (res as any)?.count ?? 1;
    if (count > limit.max) return { ok: false, retryAfter };
    return { ok: true, retryAfter: 0 };
  } catch (e) {
    // Fail over to the in-process limiter rather than failing the request:
    // a Mongo blip should not take every chatbot offline.
    console.warn('[chatbot-forge] shared rate limit unavailable, using local:', (e as Error)?.message);
    return localConsume(`${key}:${windowEnd}`, limit, now, retryAfter);
  }
}

/* ------------------------------------------------------------------ */
/* Local fallback                                                       */
/* ------------------------------------------------------------------ */

const local = new Map<string, number>();
/** Above this, the oldest entries are dropped. Bounds memory under a flood. */
const MAX_LOCAL = 20_000;

function localConsume(key: string, limit: Limit, now: number, retryAfter: number): LimitResult {
  if (local.size > MAX_LOCAL) {
    // Map preserves insertion order, so the first key is the oldest window.
    let budget = 8;
    while (local.size > MAX_LOCAL && budget-- > 0) {
      const oldest = local.keys().next();
      if (oldest.done) break;
      local.delete(oldest.value);
    }
  }
  const count = (local.get(key) ?? 0) + 1;
  local.set(key, count);
  if (count > limit.max) return { ok: false, retryAfter };
  return { ok: true, retryAfter: 0 };
}

/* ------------------------------------------------------------------ */
/* Callers                                                              */
/* ------------------------------------------------------------------ */

/**
 * @param botId  the chatbot being messaged
 * @param client a best-effort client identifier (see clientKey below)
 */
export async function rateLimit(botId: string, client: string): Promise<LimitResult> {
  const now = Date.now();

  // Client first, so a visitor already over their own limit cannot keep eating
  // the bot's shared allowance and deny everyone else.
  const clientWindow = `c:${botId}:${client}`;
  const perClient = await consume(clientWindow, PER_CLIENT, now);
  if (!perClient.ok) return { ...perClient, scope: 'client' };

  const perBot = await consume(`b:${botId}`, PER_BOT, now);
  if (!perBot.ok) {
    // Regression guard: charging the visitor for a message the bot-wide limit
    // refused used to lock them out of a chatbot that had already recovered,
    // because their own window is the slower of the two to reset.
    await refund(clientWindow, PER_CLIENT, now);
    return { ...perBot, scope: 'bot' };
  }

  return { ok: true, retryAfter: 0 };
}

/**
 * Best-effort client identifier.
 *
 * `x-forwarded-for` is attacker-controlled: anyone can send a header, and a
 * proxy that appends leaves the forged value first in the list. The last entry
 * is the hop closest to this server and is the hardest to forge, so it is
 * preferred, after any header the platform itself sets.
 *
 * If you run behind a known number of proxies, replace this with the hop at
 * that fixed offset, which is the only fully reliable approach.
 */
export function clientKey(headers: Headers): string {
  const platform = headers.get('x-nf-client-connection-ip') || headers.get('x-vercel-forwarded-for') || headers.get('cf-connecting-ip') || headers.get('x-real-ip');
  if (platform) return platform.trim().slice(0, 64);

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1].slice(0, 64);
  }
  return 'unknown';
}

/** Test hook: forget the local fallback's counters. */
export function resetRateLimits(): void {
  local.clear();
}
