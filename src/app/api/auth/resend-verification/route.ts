import { NextRequest, NextResponse } from 'next/server';
import { users } from '@/lib/mongodb';
import { sessionOf, sessionRevoked } from '@/lib/auth';
import { consume, clientKey, PER_AUTH } from '@/lib/ratelimit';
import { issueToken } from '@/lib/reset';
import { sendVerification } from '@/lib/verify-mail';
import { serverError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/resend-verification — sends a fresh confirmation link. */
export async function POST(req: NextRequest) {
  const session = sessionOf(req);
  if (!session) return NextResponse.json({ error: 'Log in first.' }, { status: 401 });

  const limit = await consume(`resend:${clientKey(req.headers)}`, { max: 5, windowSec: 3_600 });
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'A link was sent recently. Check your spam folder before asking for another.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  try {
    const col = await users();
    const user = await col.findOne({ id: session.userId });
    if (!user || user.deletedAt || sessionRevoked(session, user)) {
      return NextResponse.json({ error: 'Log in first.' }, { status: 401 });
    }
    if (user.emailVerifiedAt) return NextResponse.json({ ok: true, alreadyVerified: true });

    const token = await issueToken(user, 'verify');
    await sendVerification(req, user.email, token);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
