import { NextRequest, NextResponse } from 'next/server';
import { bots, bookings, users, ledger, passwordResets, conversations } from '@/lib/mongodb';
import { SESSION_COOKIE, sessionCookieOptions, sessionOf, sessionRevoked, verifyPassword } from '@/lib/auth';
import { consume, clientKey, PER_AUTH } from '@/lib/ratelimit';
import { deleteAllKnowledge } from '@/lib/knowledge/ingest';
import { serverError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET  /api/auth/account — everything stored about this account, as JSON.
 * DELETE /api/auth/account — { password } — erases it.
 *
 * Both exist because "we hold your data" is only defensible alongside "and you
 * can take it or end it". Deletion is real deletion, not a flag: the bots, the
 * knowledge they were built from, the transcripts, the bookings visitors left,
 * and the account row itself all go.
 *
 * The account is marked deleted first, so a request that dies halfway through
 * cannot leave a working login attached to half-erased data.
 */
export async function GET(req: NextRequest) {
  const session = sessionOf(req);
  if (!session) return NextResponse.json({ error: 'Log in first.' }, { status: 401 });

  try {
    const user = await (await users()).findOne(
      { id: session.userId },
      { projection: { _id: 0, passwordHash: 0 } },
    );
    if (!user || user.deletedAt || sessionRevoked(session, user)) {
      return NextResponse.json({ error: 'Log in first.' }, { status: 401 });
    }

    const ownedBots = await (await bots())
      .find({ ownerId: user.id }, { projection: { _id: 0, apiKeyEnc: 0, embeddingKeyEnc: 0 } })
      .toArray();
    const botIds = ownedBots.map((b) => b.id);

    const [bookingRows, ledgerRows, transcripts] = await Promise.all([
      (await bookings()).find({ botId: { $in: botIds } }, { projection: { _id: 0 } }).toArray(),
      (await ledger()).find({ userId: user.id }, { projection: { _id: 0 } }).toArray(),
      (await conversations()).find({ ownerId: user.id }, { projection: { _id: 0 } }).toArray(),
    ]);

    return new NextResponse(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          // API keys are deliberately absent: they are encrypted at rest and
          // an export is a file that ends up in a downloads folder.
          note: 'Stored provider API keys are not included. Re-enter them if you rebuild elsewhere.',
          account: user,
          bots: ownedBots,
          bookings: bookingRows,
          creditHistory: ledgerRows,
          conversations: transcripts,
        },
        null,
        2,
      ),
      {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="chatbot-forge-export.json"',
        },
      },
    );
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(req: NextRequest) {
  const session = sessionOf(req);
  if (!session) return NextResponse.json({ error: 'Log in first.' }, { status: 401 });

  const limit = await consume(`delete:${clientKey(req.headers)}`, PER_AUTH);
  if (!limit.ok) return NextResponse.json({ error: 'Too many attempts.' }, { status: 429 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    const col = await users();
    const user = await col.findOne({ id: session.userId });
    if (!user || user.deletedAt || sessionRevoked(session, user)) {
      return NextResponse.json({ error: 'Log in first.' }, { status: 401 });
    }

    // The password again, because this is irreversible and a session cookie is
    // the one thing an attacker at a borrowed laptop already has.
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: 'That password is not right.' }, { status: 403 });
    }

    // Closes the door before the erasing starts.
    await col.updateOne(
      { id: user.id },
      { $set: { deletedAt: new Date().toISOString(), sessionsValidFrom: Date.now() } },
    );

    const botsCol = await bots();
    const owned = await botsCol.find({ ownerId: user.id }, { projection: { _id: 0, id: 1 } }).toArray();
    const botIds = owned.map((b) => b.id as string);

    for (const id of botIds) {
      await deleteAllKnowledge(id).catch(() => {});
    }
    await botsCol.deleteMany({ ownerId: user.id });
    if (botIds.length) await (await bookings()).deleteMany({ botId: { $in: botIds } });
    await (await conversations()).deleteMany({ ownerId: user.id });
    await (await passwordResets()).deleteMany({ userId: user.id } as any);
    // The ledger goes too: it is a record of this person's payments, and there
    // is no separate accounting system here that needs it kept.
    await (await ledger()).deleteMany({ userId: user.id });
    await col.deleteOne({ id: user.id });

    const res = NextResponse.json({ ok: true, deleted: { bots: botIds.length } });
    res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
    return res;
  } catch (e) {
    return serverError(e);
  }
}
