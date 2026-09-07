import { createHash, randomBytes } from 'node:crypto';
import { passwordResets, users } from './mongodb';
import type { ResetDoc, UserDoc } from './types';

/**
 * Password resets and email verification, which share a token shape.
 *
 * Only the hash of a token is stored. A reset token is a password equivalent
 * for the length of its life, so a database dump must not hand over the ability
 * to take accounts — the same reason `passwordHash` is not the password.
 *
 * Tokens are single-use and short-lived, and spending one invalidates every
 * existing session on the account: whoever forced the reset should not still be
 * holding a working cookie afterwards.
 */

const RESET_TTL_MINUTES = 60;
const VERIFY_TTL_HOURS = 48;

export type TokenPurpose = 'reset' | 'verify';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Issues a token for an account and returns the raw value, which only ever
 * exists in the email that carries it.
 */
export async function issueToken(
  user: Pick<UserDoc, 'id' | 'email'>,
  purpose: TokenPurpose,
): Promise<string> {
  const token = newToken();
  const ttlMs = purpose === 'reset' ? RESET_TTL_MINUTES * 60_000 : VERIFY_TTL_HOURS * 3_600_000;

  const doc: ResetDoc & { purpose: TokenPurpose } = {
    tokenHash: hashToken(token),
    userId: user.id,
    email: user.email,
    purpose,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlMs),
  };

  const col = await passwordResets();
  await col.insertOne(doc as any);
  return token;
}

export interface TokenCheck {
  ok: boolean;
  userId?: string;
  email?: string;
  error?: string;
}

/**
 * Spends a token, or explains why it cannot be spent.
 *
 * The `usedAt` filter is part of the update rather than a separate read, so two
 * requests carrying the same token cannot both succeed.
 */
export async function consumeToken(token: string, purpose: TokenPurpose): Promise<TokenCheck> {
  if (!token || typeof token !== 'string' || token.length < 20) {
    return { ok: false, error: 'That link is not valid.' };
  }

  const col = await passwordResets();
  const res = await col.findOneAndUpdate(
    { tokenHash: hashToken(token), purpose, usedAt: { $exists: false } } as any,
    { $set: { usedAt: new Date().toISOString() } },
    { returnDocument: 'after' },
  );
  const doc: any = (res as any)?.value ?? res;
  if (!doc) return { ok: false, error: 'That link has already been used, or is not valid.' };

  // The TTL index removes expired documents eventually, not instantly, so the
  // date is checked rather than trusted to have been swept.
  if (new Date(doc.expiresAt).getTime() < Date.now()) {
    return { ok: false, error: 'That link has expired. Request a new one.' };
  }

  return { ok: true, userId: doc.userId, email: doc.email };
}

/**
 * Ends every session on an account.
 *
 * Session tokens are self-contained and signed, so there is nothing to delete —
 * the account instead records the moment before which tokens are no longer
 * accepted, and `sessionRevoked` enforces it on the way in.
 */
export async function revokeSessions(userId: string): Promise<void> {
  const col = await users();
  await col.updateOne({ id: userId }, { $set: { sessionsValidFrom: Date.now() } });
}

/** Drops any outstanding tokens for an account, e.g. after a successful reset. */
export async function clearTokens(userId: string, purpose: TokenPurpose): Promise<void> {
  const col = await passwordResets();
  await col.deleteMany({ userId, purpose } as any);
}

