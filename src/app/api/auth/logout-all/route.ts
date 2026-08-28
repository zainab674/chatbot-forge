import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, sessionCookieOptions, sessionOf } from '@/lib/auth';
import { revokeSessions } from '@/lib/reset';
import { serverError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/logout-all
 *
 * Plain logout only clears the cookie in the browser it was clicked in, which
 * is no help at all if a session token has been copied off a shared machine.
 * This moves the account's cutoff forward instead, so every token issued
 * before now — on every device — stops being accepted.
 */
export async function POST(req: NextRequest) {
  const session = sessionOf(req);
  if (!session) return NextResponse.json({ error: 'Log in first.' }, { status: 401 });

  try {
    await revokeSessions(session.userId);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
    return res;
  } catch (e) {
    return serverError(e);
  }
}
