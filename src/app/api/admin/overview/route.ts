import { NextRequest, NextResponse } from 'next/server';
import { users, bots, bookings } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin';
import { isAdminEmail } from '@/lib/auth';
import { serverError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/overview — everything the admin panel shows in one call:
 * platform totals, the user list, and the bot list (joined to owner emails).
 */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin(req);
    if ('error' in guard) return guard.error;

    const usersCol = await users();
    const botsCol = await bots();
    const bookingsCol = await bookings();

    const [userList, botList, bookingCount] = await Promise.all([
      usersCol
        .find({}, { projection: { _id: 0, passwordHash: 0 } })
        .sort({ createdAt: -1 })
        .limit(500)
        .toArray(),
      botsCol
        .find(
          {},
          {
            projection: {
              _id: 0,
              id: 1,
              name: 1,
              ownerId: 1,
              provider: 1,
              model: 1,
              apiKeyMask: 1,
              messageCount: 1,
              isPublic: 1,
              createdAt: 1,
            },
          },
        )
        .sort({ createdAt: -1 })
        .limit(500)
        .toArray(),
      bookingsCol.countDocuments({}),
    ]);

    const emailByOwner = new Map(userList.map((u) => [u.id, u.email]));
    const botsByOwner = new Map<string, number>();
    let totalMessages = 0;
    for (const b of botList) {
      botsByOwner.set(b.ownerId, (botsByOwner.get(b.ownerId) ?? 0) + 1);
      totalMessages += b.messageCount ?? 0;
    }

    return NextResponse.json({
      stats: {
        users: userList.length,
        bots: botList.length,
        messages: totalMessages,
        bookings: bookingCount,
        creditsOutstanding: userList.reduce((s, u) => s + (u.credits ?? 0), 0),
        admins: userList.filter((u) => u.role === 'admin' || isAdminEmail(u.email)).length,
      },
      users: userList.map((u) => ({
        email: u.email,
        credits: u.credits ?? 0,
        createdAt: u.createdAt,
        bots: botsByOwner.get(u.id) ?? 0,
        // The *effective* role, so the root admin does not read as a plain
        // user just because its stored role was never written. This is the
        // same rule `isAdmin` applies when guarding the API.
        role: u.role === 'admin' || isAdminEmail(u.email) ? 'admin' : 'user',
        // The panel greys out the rows it must not let you change, and these
        // two flags are the reasons why — mirroring the guards in
        // PATCH /api/admin/users so the UI never offers a doomed request.
        isRoot: isAdminEmail(u.email),
        isSelf: u.id === guard.admin.id,
      })),
      bots: botList.map((b) => ({
        id: b.id,
        name: b.name,
        owner: emailByOwner.get(b.ownerId) ?? '(anonymous)',
        provider: b.provider,
        model: b.model,
        hasOwnKey: Boolean(b.apiKeyMask),
        messages: b.messageCount ?? 0,
        isPublic: b.isPublic ?? true,
        createdAt: b.createdAt,
      })),
    });
  } catch (e) {
    return serverError(e);
  }
}
