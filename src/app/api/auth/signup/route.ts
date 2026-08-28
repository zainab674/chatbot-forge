import { NextRequest, NextResponse } from 'next/server';
import { users, bots } from '@/lib/mongodb';
import { newId } from '@/lib/crypto';
import { consume, clientKey, PER_AUTH } from '@/lib/ratelimit';
import {
  hashPassword,
  createSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE,
  normalizeEmail,
  validEmail,
  isAdmin,
  anonClaimFilter,
} from '@/lib/auth';
import { serverError } from '@/lib/http';
import { issueToken } from '@/lib/reset';
import { sendVerification } from '@/lib/verify-mail';
import type { UserDoc } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/signup — { email, password, ownerId? }
 *
 * `ownerId` is the browser's anonymous id; passing it moves the bots created
 * before signing up onto the new account, so nothing disappears.
 */
export async function POST(req: NextRequest) {
  const ip = clientKey(req.headers);
  const perIp = await consume(`auth:${ip}`, PER_AUTH);
  if (!perIp.ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Give it a moment.' },
      { status: 429, headers: { 'Retry-After': String(perIp.retryAfter) } },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!validEmail(email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password needs at least 8 characters.' }, { status: 400 });
  }

  try {
    const col = await users();
    if (await col.findOne({ email })) {
      return NextResponse.json({ error: 'An account with this email already exists. Log in instead.' }, { status: 409 });
    }

    const user: UserDoc = {
      id: newId(),
      email,
      passwordHash: hashPassword(password),
      credits: 0,
      // Everyone starts as a plain user. The root admin comes from
      // ADMIN_EMAIL, and every other admin is promoted from the panel.
      role: 'user',
      createdAt: new Date().toISOString(),
    };
    try {
      await col.insertOne(user as any);
    } catch (e: any) {
      // The findOne above is not enough on its own: two signups for the same
      // address can both pass it and both insert. The unique index on `email`
      // is what actually enforces this, and error 11000 is the loser of that
      // race — which is the same situation as the check above, so it gets the
      // same answer rather than a 500.
      if (e?.code === 11000) {
        return NextResponse.json(
          { error: 'An account with this email already exists. Log in instead.' },
          { status: 409 },
        );
      }
      throw e;
    }

    const anonId = typeof body?.ownerId === 'string' ? body.ownerId : '';
    if (anonId.length >= 8 && anonId.length <= 64) {
      const botsCol = await bots();
      await botsCol.updateMany(anonClaimFilter(anonId), { $set: { ownerId: user.id } });
    }

    // Sent, not awaited for correctness: a mailer outage must not stop someone
    // creating an account, and the address can be confirmed later from /account.
    issueToken(user, 'verify')
      .then((token) => sendVerification(req, user.email, token))
      .catch((e) => console.error('[chatbot-forge] verification email failed:', e));

    const res = NextResponse.json({
      user: { email: user.email, credits: user.credits, isAdmin: isAdmin(user), emailVerified: false },
    });
    res.cookies.set(SESSION_COOKIE, createSessionToken(user.id), sessionCookieOptions);
    return res;
  } catch (e) {
    return serverError(e);
  }
}
