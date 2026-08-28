import { NextRequest, NextResponse } from 'next/server';
import { users } from '@/lib/mongodb';
import { sessionOf, sessionRevoked, isAdmin } from '@/lib/auth';
import { serverError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/auth/me — the logged-in account, or { user: null }. */
export async function GET(req: NextRequest) {
  const session = sessionOf(req);
  if (!session) return NextResponse.json({ user: null });

  try {
    const col = await users();
    const user = await col.findOne({ id: session.userId }, { projection: { _id: 0, passwordHash: 0 } });
    // A revoked session reads as logged out, which is what the browser then
    // renders — no stale dashboard for a cookie the account has disowned.
    if (!user || user.deletedAt || sessionRevoked(session, user)) return NextResponse.json({ user: null });
    return NextResponse.json({
      user: {
        email: user.email,
        credits: user.credits ?? 0,
        isAdmin: isAdmin(user),
        emailVerified: Boolean(user.emailVerifiedAt),
      },
    });
  } catch (e) {
    return serverError(e);
  }
}
