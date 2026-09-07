import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

/**
 * Accounts without a dependency: scrypt for passwords, an HMAC-signed cookie
 * for sessions. The signing key is derived from ENCRYPTION_SECRET, which the
 * app already requires, so there is no second secret to rotate (and the same
 * warning applies: changing it logs everyone out).
 *
 * Anonymous browser-id ownership keeps working untouched — `resolveOwner`
 * simply prefers the session when one is present. Logging in "claims" the
 * anonymous bots (see the auth routes), which fixes the old failure mode of
 * clearing the browser and losing your dashboard.
 */

export const SESSION_COOKIE = 'cf_session';
const SESSION_DAYS = 30;

/* ------------------------------------------------------------------ */
/* Passwords                                                            */
/* ------------------------------------------------------------------ */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `s2$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 3 || parts[0] !== 's2') return false;
  try {
    const expected = Buffer.from(parts[2], 'hex');
    const actual = scryptSync(password, parts[1], 64);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Session tokens                                                       */
/* ------------------------------------------------------------------ */

function signingKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('ENCRYPTION_SECRET is not set (or too short); sessions cannot be signed.');
  }
  // Derived, so the raw secret is never used as an HMAC key directly.
  return createHmac('sha256', 'cf-session-v1').update(secret).digest();
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

export function createSessionToken(userId: string, now = Date.now()): string {
  const exp = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  // `now` is the issue time and is what makes revocation possible: an account
  // records when its sessions were invalidated, and any token issued before
  // that moment stops being accepted. Without it a stolen cookie stayed valid
  // for thirty days no matter what the owner did, because logout only cleared
  // the cookie in the browser it was clicked in.
  const payload = `${userId}.${now}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export interface Session {
  userId: string;
  /** When this token was issued, in ms. Zero for tokens that predate the field. */
  issuedAt: number;
}

/** Returns the session, or null for a missing/expired/tampered token. */
export function verifySession(token: string | undefined | null, now = Date.now()): Session | null {
  if (!token) return null;
  const i = token.lastIndexOf('.');
  if (i <= 0) return null;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  const parts = payload.split('.');
  // Tokens issued before sessions carried an issue time have two parts. They
  // stay valid — but with an issue time of zero, so the first password reset
  // invalidates them like everything else.
  const [userId, a, b] = parts;
  const issuedAt = parts.length >= 3 ? parseInt(a, 10) : 0;
  const exp = parseInt(parts.length >= 3 ? b : a, 10);
  if (!userId || !Number.isFinite(exp) || exp < now) return null;
  return { userId, issuedAt: Number.isFinite(issuedAt) ? issuedAt : 0 };
}

/**
 * Returns the user id, or null. Signature and expiry only.
 *
 * Deliberately not enough on its own for anything that reads or spends account
 * data: it cannot see a revoked session or a deleted account, because both live
 * in the database. Pair it with `sessionRevoked` — or use `resolveOwner` — on
 * any route that acts for the user. The server-rendered pages below use it to
 * decide what to render, and the routes they call check properly.
 */
export function verifySessionToken(token: string | undefined | null, now = Date.now()): string | null {
  return verifySession(token, now)?.userId ?? null;
}

/**
 * True when this token was issued before the account invalidated its sessions.
 *
 * `sessionsValidFrom` is bumped by a password reset and by "sign out
 * everywhere", which is the only thing that can actually end a session: the
 * token is self-contained and signed, so nothing else about it changes when a
 * user wants their other devices logged out.
 */
export function sessionRevoked(session: Session, user: { sessionsValidFrom?: number } | null | undefined): boolean {
  const validFrom = user?.sessionsValidFrom ?? 0;
  // One second of slack: the token's issue time and the stored cutoff are
  // written by the same request during a reset, and rounding should not log
  // someone straight back out of the session they just created.
  return session.issuedAt + 1_000 < validFrom;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_DAYS * 24 * 60 * 60,
};

/* ------------------------------------------------------------------ */
/* Request helpers                                                      */
/* ------------------------------------------------------------------ */

/** The signed session on this request, before any revocation check. */
export function sessionOf(req: NextRequest): Session | null {
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value);
}

/**
 * Anonymous draft owners are `anon:` + the browser's localStorage id. The
 * prefix is the security boundary: a forged `x-owner-id` header can only ever
 * resolve to an `anon:`-prefixed owner, which can never collide with a real
 * user id — so header identity reaches anonymous drafts and nothing else.
 */
export const ANON_PREFIX = 'anon:';

/**
 * The shape of an anonymous browser id.
 *
 * Long random ids only: too short to be guessable is too short to accept, and a
 * real user id (12 chars, see `newId`) can never match even before the prefix.
 * Both the header path and the claim path below check against this one pattern,
 * because the moment the two disagree about what an anonymous id looks like,
 * the looser of them becomes the way in.
 */
const ANON_ID = /^[A-Za-z0-9_-]{16,64}$/;

export function isAnonId(value: unknown): value is string {
  return typeof value === 'string' && ANON_ID.test(value);
}

export function isAnonOwner(ownerId: string | null | undefined): boolean {
  return typeof ownerId === 'string' && ownerId.startsWith(ANON_PREFIX);
}

/**
 * Who owns things: the logged-in user when there is a session; otherwise the
 * browser's anonymous id, so visitors can build and manage draft bots before
 * signing up. The line that must not move: anything involving an API key
 * requires an account — a key deserves better protection than a random id in
 * localStorage that anyone on a shared computer inherits. Signup/login claims
 * the anonymous drafts onto the new account (see the auth routes).
 */
export async function resolveOwner(req: NextRequest): Promise<string | null> {
  const session = sessionOf(req);
  if (session) {
    // Costs one indexed lookup, and is what makes "sign out everywhere" and a
    // password reset mean anything on this surface rather than only on /me.
    const { users } = await import('./mongodb');
    const user = await (await users()).findOne({ id: session.userId }, { projection: { _id: 0, passwordHash: 0 } });
    // A deletion in flight has already marked the account and revoked its
    // sessions; nothing should still answer as its owner while the rest of the
    // erasing catches up.
    if (user && !user.deletedAt && !sessionRevoked(session, user)) return session.userId;
    if (user) return null;
  }
  const anon = req.headers.get('x-owner-id')?.trim() ?? '';
  if (isAnonId(anon)) return ANON_PREFIX + anon;
  return null;
}

/**
 * Matches a browser's drafts whether stored with the prefix or from the
 * pre-accounts era without it — used by signup/login to claim them.
 *
 * Returns null for anything not shaped like an anonymous browser id, and that
 * check is a security boundary rather than tidiness. The bare arm of the `$in`
 * matches how an *account's* bots are stored too, so a caller free to put an
 * arbitrary string in here could name another account's user id at login and
 * have every chatbot that account owns — stored API key included — moved onto
 * its own. `ANON_ID` is what keeps a real user id (12 chars) out.
 */
export function anonClaimFilter(anonId: unknown): { ownerId: { $in: string[] } } | null {
  if (!isAnonId(anonId)) return null;
  return { ownerId: { $in: [anonId, ANON_PREFIX + anonId] } };
}

/** The message every owner-scoped route returns to a caller with no identity. */
export const LOGIN_REQUIRED = 'Log in to manage your chatbots.';

/** Returned when an anonymous draft tries to save an API key. */
export const SIGNUP_FOR_KEYS =
  'Create a free account to save an API key — keys are encrypted and stored only on accounts, never on anonymous drafts.';

/**
 * The root admin's address, normalised — or null when none is configured.
 *
 * Exported because callers that need to *query* for the root admin (rather than
 * test one address against it) were otherwise re-implementing the trim and
 * lowercase by hand, and a second copy of that is a second chance to get it
 * subtly different.
 */
export function rootAdminEmail(): string | null {
  return process.env.ADMIN_EMAIL?.trim().toLowerCase() || null;
}

export function isAdminEmail(email: string | undefined | null): boolean {
  const admin = rootAdminEmail();
  return Boolean(admin && email && email.trim().toLowerCase() === admin);
}

/**
 * Whether an account may use the admin panel.
 *
 * There are two ways in, on purpose. `ADMIN_EMAIL` is the *root* admin: it
 * lives in the environment, always passes, and cannot be demoted through the
 * UI. Without it nobody could appoint the first admin, and one careless
 * demotion could lock every human out of the panel permanently. Every other
 * admin is promoted by an existing one and carries `role: 'admin'` in the
 * database, so the set of admins survives an environment change.
 */
export function isAdmin(user: { email?: string | null; role?: string | null } | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'admin' || isAdminEmail(user.email);
}

export function normalizeEmail(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase().slice(0, 200) : '';
}

export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}
