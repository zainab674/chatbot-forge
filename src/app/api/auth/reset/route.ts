import { NextRequest, NextResponse } from 'next/server';
import { users } from '@/lib/mongodb';
import { hashPassword, createSessionToken, sessionCookieOptions, SESSION_COOKIE, isAdmin } from '@/lib/auth';
import { consume, clientKey, PER_AUTH } from '@/lib/ratelimit';
import { consumeToken, clearTokens } from '@/lib/reset';
import { serverError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/reset — { token, password }
 *
 * Spending the token sets the new password, ends every existing session on the
 * account, and signs this browser back in. Ending the sessions is the point:
 * whoever prompted the reset must not still be holding a working cookie.
 */
export async function POST(req: NextRequest) {
  const limit = await consume(`reset:${clientKey(req.headers)}`, PER_AUTH);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Give it a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const token = typeof body?.token === 'string' ? body.token : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password needs at least 8 characters.' }, { status: 400 });
  }

  try {
    const check = await consumeToken(token, 'reset');
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

    const col = await users();
    const user = await col.findOne({ id: check.userId! });
    if (!user || user.deletedAt) return NextResponse.json({ error: 'That account no longer exists.' }, { status: 400 });

    const now = Date.now();
    await col.updateOne(
      { id: user.id },
      {
        $set: {
          passwordHash: hashPassword(password),
          sessionsValidFrom: now,
          // Following a link proves the address works, so verification is done.
          emailVerifiedAt: user.emailVerifiedAt ?? new Date().toISOString(),
        },
      },
    );
    await clearTokens(user.id, 'reset');

    const res = NextResponse.json({
      user: { email: user.email, credits: user.credits ?? 0, isAdmin: isAdmin(user), emailVerified: true },
    });
    // Issued after the cutoff above, so this is the one session that survives.
    res.cookies.set(SESSION_COOKIE, createSessionToken(user.id, now + 1_000), sessionCookieOptions);
    return res;
  } catch (e) {
    return serverError(e);
  }
}
