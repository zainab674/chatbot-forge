import { getProvider } from './providers';
import { getPlatformKey } from './platform-keys';
import { users, ledger } from './mongodb';
import { newId } from './crypto';
import { consume, type Limit } from './ratelimit';
import { PLATFORM_MODELS, ANON_TRIAL_MESSAGES } from './platform';
import type { BotDoc, LedgerDoc, LedgerReason } from './types';

/**
 * The paid tier: bots whose creator saved no API key can run on the platform's
 * own keys (set by an admin in /admin), one credit per message — but only when
 * the owner is a registered account with credits left, and only on the cheap
 * models in PLATFORM_MODELS. Everything else stays bring-your-own-key.
 *
 * The one exception is the anonymous-draft trial below, which exists so the
 * signup wall sits after "I saw it talk", not before.
 *
 * Two rules run through this file, and both exist because the money is real:
 *
 *   1. Credits are *reserved* before the model call, not spent after it. The
 *      old code checked the balance, streamed the answer, and decremented
 *      afterwards without waiting — so ten concurrent messages all saw the same
 *      balance and all went through. An account with one credit could spend
 *      however many the visitor could fire at once.
 *
 *   2. A credit buys a bounded amount of work. A message could carry 12k
 *      characters per turn across 24 turns and still cost exactly one credit,
 *      which made the platform's cost per credit unbounded. Cost is now
 *      estimated up front and charged for.
 */

export { PLATFORM_MODELS, ANON_TRIAL_MESSAGES };

export type DenyReason =
  | 'no-platform-key'
  | 'model-not-included'
  | 'no-account'
  | 'no-credits'
  | 'trial-exhausted'
  | 'trial-ip-exhausted';

export interface PlatformGrant {
  apiKey: string;
  userId: string;
  /** How many credits were taken, so the caller can hand them back on failure. */
  charged: number;
}

/* ------------------------------------------------------------------ */
/* What a credit buys                                                   */
/* ------------------------------------------------------------------ */

/**
 * One credit covers this much work. Four characters to a token is the usual
 * rough conversion and is close enough for billing that rounds up anyway.
 */
export const TOKENS_PER_CREDIT = 4_000;
/** How long per-message spend rows are kept. Purchases never expire. */
const SPEND_HISTORY_DAYS = 90;
const CHARS_PER_TOKEN = 4;

/**
 * Hard ceilings for a request running on the platform's money, applied before
 * anything is sent upstream. Without them a single message could ask for a
 * 200k-token context on someone else's account, and the estimate below would
 * dutifully charge for it rather than refusing.
 */
export const PLATFORM_MAX_PROMPT_CHARS = 24_000;
export const PLATFORM_MAX_OUTPUT_TOKENS = 1_024;
/**
 * A bot's own instructions can legitimately be long — the builder allows 24k
 * characters of `info` alone — so the system prompt gets its own ceiling rather
 * than being allowed to eat the whole budget and leave nothing for the visitor.
 */
export const PLATFORM_MAX_SYSTEM_CHARS = 16_000;
/** Whatever else happens, the visitor's own message gets at least this much room. */
const MIN_MESSAGE_CHARS = 2_000;

/** Credits a request of this size costs, always at least one. */
export function creditsFor(promptChars: number, maxTokens: number): number {
  const estimated = promptChars / CHARS_PER_TOKEN + maxTokens;
  return Math.max(1, Math.ceil(estimated / TOKENS_PER_CREDIT));
}

/**
 * Trims a request to what the platform tier will pay for.
 *
 * Returns what to actually send: the system prompt, the messages, and the
 * output cap. Trimming drops the oldest turns first, because the recent ones
 * are the ones that matter.
 *
 * Every branch here has to *reduce* something. An earlier version computed the
 * remaining budget as `ceiling - systemChars` and then kept the tail of the
 * last message with `slice(-budget)` — which returns the whole string when the
 * budget reaches zero, so an oversized system prompt disabled the very cap it
 * had just exhausted. Hence the floor below, and the separate system ceiling.
 */
export function fitToPlatformBudget<T extends { content: string }>(
  messages: T[],
  system: string,
  maxTokens: number,
): { messages: T[]; system: string; maxTokens: number; promptChars: number } {
  const fittedSystem =
    system.length > PLATFORM_MAX_SYSTEM_CHARS
      ? `${system.slice(0, PLATFORM_MAX_SYSTEM_CHARS)}\n\n[Instructions truncated to fit the platform credit limit.]`
      : system;

  const budget = Math.max(MIN_MESSAGE_CHARS, PLATFORM_MAX_PROMPT_CHARS - fittedSystem.length);
  const kept: T[] = [];
  let used = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (used + m.content.length > budget) {
      // Always keep the latest message, trimmed to what is left. `budget` is
      // guaranteed positive by the floor above, so this always shortens.
      if (!kept.length) kept.unshift({ ...m, content: m.content.slice(-budget) });
      break;
    }
    kept.unshift(m);
    used += m.content.length;
  }

  return {
    messages: kept,
    system: fittedSystem,
    maxTokens: Math.min(maxTokens, PLATFORM_MAX_OUTPUT_TOKENS),
    promptChars: fittedSystem.length + kept.reduce((n, m) => n + m.content.length, 0),
  };
}

/* ------------------------------------------------------------------ */
/* Balances                                                             */
/* ------------------------------------------------------------------ */

/**
 * Takes `amount` credits from an account, or nothing at all.
 *
 * The balance condition is part of the update's filter, so Mongo applies it
 * atomically: concurrent requests queue behind each other and the balance can
 * reach zero but never go below it. Returns the new balance, or null when the
 * account could not cover it.
 */
export async function reserveCredits(userId: string, amount: number, note = ''): Promise<number | null> {
  if (amount <= 0) return null;
  const col = await users();
  const res = await col.findOneAndUpdate(
    { id: userId, credits: { $gte: amount } },
    { $inc: { credits: -amount } },
    { returnDocument: 'after' },
  );
  const after = (res as any)?.value ?? (res as any);
  if (!after || typeof after.credits !== 'number') return null;

  await record(userId, -amount, after.credits, 'spend', note);
  return after.credits;
}

/** Hands credits back when the work they were reserved for did not happen. */
export async function refundCredits(userId: string, amount: number, note = ''): Promise<void> {
  if (amount <= 0) return;
  try {
    const col = await users();
    const res = await col.findOneAndUpdate(
      { id: userId },
      { $inc: { credits: amount } },
      { returnDocument: 'after' },
    );
    const after = (res as any)?.value ?? (res as any);
    await record(userId, amount, after?.credits ?? 0, 'refund', note);
  } catch (e) {
    console.error('[chatbot-forge] credit refund failed:', userId, amount, e);
  }
}

/**
 * Adds credits and writes the ledger row in one place.
 *
 * `reference` makes it idempotent: a Stripe webhook delivered three times
 * carries the same event id all three times, and the unique index on that
 * field turns the retries into no-ops instead of free money.
 */
export async function grantCredits(
  userId: string,
  amount: number,
  reason: LedgerReason,
  note: string,
  reference?: string,
): Promise<{ credits: number; alreadyApplied: boolean }> {
  const usersCol = await users();

  if (reference) {
    const ledgerCol = await ledger();
    const seen = await ledgerCol.findOne({ reference });
    if (seen) {
      const user = await usersCol.findOne({ id: userId });
      return { credits: user?.credits ?? 0, alreadyApplied: true };
    }
  }

  const res = await usersCol.findOneAndUpdate(
    { id: userId },
    { $inc: { credits: amount } },
    { returnDocument: 'after' },
  );
  const after = (res as any)?.value ?? (res as any);
  // A correction must not push a balance negative.
  let credits = after?.credits ?? 0;
  if (credits < 0) {
    await usersCol.updateOne({ id: userId }, { $set: { credits: 0 } });
    credits = 0;
  }

  await record(userId, amount, credits, reason, note, reference);
  return { credits, alreadyApplied: false };
}

async function record(
  userId: string,
  delta: number,
  balanceAfter: number,
  reason: LedgerReason,
  note: string,
  reference?: string,
): Promise<void> {
  try {
    const col = await ledger();
    const row: LedgerDoc = {
      id: newId(),
      userId,
      delta,
      balanceAfter,
      reason,
      note: note.slice(0, 300),
      createdAt: new Date().toISOString(),
    };
    if (reference) row.reference = reference;
    // One row per message adds up fast, and nobody audits last year's
    // individual messages. Anything involving money is kept indefinitely.
    if (reason === 'spend') row.expiresAt = new Date(Date.now() + SPEND_HISTORY_DAYS * 86_400_000);
    await col.insertOne(row as any);
  } catch (e) {
    // The ledger is the audit trail, not the balance. Losing a row is worth a
    // log line, never a failed message.
    console.warn('[chatbot-forge] ledger write failed:', (e as Error)?.message);
  }
}

/* ------------------------------------------------------------------ */
/* Grants                                                               */
/* ------------------------------------------------------------------ */

/**
 * May this owner run this model on the platform's key right now — and if so,
 * take payment for it.
 *
 * Credits are gone by the time this returns. The caller refunds `grant.charged`
 * if the model never answered.
 */
export async function platformGrant(
  ownerId: string,
  providerId: string,
  model: string,
  cost = 1,
): Promise<{ grant?: PlatformGrant; reason?: DenyReason }> {
  const provider = getProvider(providerId);
  if (!provider) return { reason: 'no-platform-key' };
  if (!PLATFORM_MODELS.has(model)) return { reason: 'model-not-included' };

  const platformKey = await getPlatformKey(provider.id);
  if (!platformKey) return { reason: 'no-platform-key' };

  const col = await users();
  const user = await col.findOne({ id: ownerId });
  if (!user) return { reason: 'no-account' };

  const balance = await reserveCredits(ownerId, cost, `${provider.id}/${model}`);
  if (balance === null) return { reason: 'no-credits' };

  return { grant: { apiKey: platformKey, userId: user.id, charged: cost } };
}

/* ------------------------------------------------------------------ */
/* Anonymous trial                                                      */
/* ------------------------------------------------------------------ */

/**
 * Anonymous drafts get a small taste of the platform keys so the builder's live
 * test works before signup. Nobody's credits are spent — the platform absorbs
 * it — so the only thing standing between this and a stranger's invoice is the
 * budget below.
 *
 * Counted in the shared rate-limit store rather than on the bot document,
 * because the bot's own `messageCount` was updated fire-and-forget after the
 * answer started streaming: ten simultaneous requests all read zero. These
 * counters are atomic and shared across instances.
 *
 * The per-IP budget is the one that matters. A per-bot cap alone counted for
 * nothing, because the "owner" of an anonymous draft is a header the caller
 * makes up — rotate it, create another draft, get another ten messages, for as
 * long as you like.
 */
const TRIAL_PER_BOT: Limit = { max: ANON_TRIAL_MESSAGES, windowSec: 30 * 86_400 };
/** Whole-IP daily ceiling on free platform messages, across every draft. */
export const TRIAL_PER_IP: Limit = { max: 40, windowSec: 86_400 };

export async function trialGrant(
  bot: Pick<BotDoc, 'id' | 'provider' | 'model'>,
  client: string,
): Promise<{ apiKey?: string; reason?: DenyReason }> {
  const provider = getProvider(bot.provider);
  if (!provider) return { reason: 'no-platform-key' };
  if (!PLATFORM_MODELS.has(bot.model)) return { reason: 'model-not-included' };

  // The key is fetched before anything is counted, so a deployment with no
  // platform key configured does not silently burn a visitor's trial budget.
  const platformKey = await getPlatformKey(provider.id);
  if (!platformKey) return { reason: 'no-platform-key' };

  const perBot = await consume(`trial:bot:${bot.id}`, TRIAL_PER_BOT);
  if (!perBot.ok) return { reason: 'trial-exhausted' };

  const perIp = await consume(`trial:ip:${client}`, TRIAL_PER_IP);
  if (!perIp.ok) return { reason: 'trial-ip-exhausted' };

  return { apiKey: platformKey };
}

/** What a visitor-facing error should say for each denial. */
export function denialMessage(reason: DenyReason | undefined): string {
  switch (reason) {
    case 'trial-exhausted':
      return `This draft chatbot has used its ${ANON_TRIAL_MESSAGES} free trial messages. Its owner can sign up (free) and add an API key — or credits — to keep it running.`;
    case 'trial-ip-exhausted':
      return 'The free trial limit for this network has been reached for today. Create a free account to keep going.';
    case 'no-credits':
      return 'This chatbot has run out of platform credits. Its owner needs to top up, or add their own API key.';
    case 'model-not-included':
      return 'This model is not covered by platform credits. The owner needs to add their own API key, or switch to an included model.';
    default:
      return 'This chatbot has no API key configured yet. Its owner needs to add one.';
  }
}
