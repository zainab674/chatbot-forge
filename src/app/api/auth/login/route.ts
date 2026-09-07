import { NextRequest, NextResponse } from 'next/server';
import { users, bots } from '@/lib/mongodb';
import { consume, clientKey, PER_AUTH } from '@/lib/ratelimit';
import {
  verifyPassword,
  createSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE,
  normalizeEmail,
  isAdmin,
  anonClaimFilter,
} from '@/lib/auth';
import { serverError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/login — { email, password, ownerId? } */
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

  // Also counted per account, not only per IP: a spread-out attempt from many
  // addresses against one inbox would otherwise never touch a limit.
  if (email) {
    const perEmail = await consume(`auth:email:${email}`, PER_AUTH);
    if (!perEmail.ok) {
      return NextResponse.json(
        { error: 'Too many attempts on this account. Give it a few minutes.' },
        { status: 429, headers: { 'Retry-After': String(perEmail.retryAfter) } },
      );
    }
  }

  try {
    const col = await users();
    const user = await col.findOne({ email });
    // Same message for all three failures, so the endpoint does not confirm
    // which emails have accounts — including the deleted ones. A deletion marks
    // the row before it erases anything (see /api/auth/account), and handing out
    // a session in that window produces a login that every other route then
    // refuses, because they all check `deletedAt` and this one used not to.
    if (!user || user.deletedAt || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: 'Wrong email or password.' }, { status: 401 });
    }

    const claim = anonClaimFilter(body?.ownerId);
    if (claim) {
      const botsCol = await bots();
      await botsCol.updateMany(claim, { $set: { ownerId: user.id } });
    }

    const res = NextResponse.json({
      user: { email: user.email, credits: user.credits ?? 0, isAdmin: isAdmin(user) },
    });
    res.cookies.set(SESSION_COOKIE, createSessionToken(user.id), sessionCookieOptions);
    return res;
  } catch (e) {
    return serverError(e);
  }
}
