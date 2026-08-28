import { NextRequest, NextResponse } from 'next/server';
import { users, ledger } from '@/lib/mongodb';
import { sessionOf, sessionRevoked } from '@/lib/auth';
import { serverError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/billing/history — this account's credit movements, newest first.
 *
 * "Where did my credits go" needs an answer that is not a guess, and the ledger
 * is the only record of one: the balance itself is just a number.
 */
export async function GET(req: NextRequest) {
  const session = sessionOf(req);
  if (!session) return NextResponse.json({ error: 'Log in first.' }, { status: 401 });

  try {
    const user = await (await users()).findOne({ id: session.userId });
    if (!user || user.deletedAt || sessionRevoked(session, user)) {
      return NextResponse.json({ error: 'Log in first.' }, { status: 401 });
    }

    const entries = await (await ledger())
      .find({ userId: session.userId }, { projection: { _id: 0, userId: 0, reference: 0 } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    return NextResponse.json({ credits: user.credits ?? 0, entries });
  } catch (e) {
    return serverError(e);
  }
}
