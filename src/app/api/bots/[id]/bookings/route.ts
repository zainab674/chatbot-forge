import { NextRequest, NextResponse } from 'next/server';
import { bots, bookings } from '@/lib/mongodb';
import { serverError } from '@/lib/http';
import { resolveOwner, LOGIN_REQUIRED } from '@/lib/auth';
import type { BotDoc } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/bots/:id/bookings — the owner's list, newest first. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ownerId = await resolveOwner(req);
    if (!ownerId) return NextResponse.json({ error: LOGIN_REQUIRED }, { status: 401 });

    const botsCol = await bots();
    const doc = (await botsCol.findOne({ id: params.id }, { projection: { _id: 0, id: 1, ownerId: 1 } })) as BotDoc | null;
    if (!doc || doc.ownerId !== ownerId) {
      return NextResponse.json({ error: 'Chatbot not found.' }, { status: 404 });
    }

    const col = await bookings();
    const list = await col
      .find({ botId: params.id }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();
    return NextResponse.json({ bookings: list });
  } catch (e) {
    return serverError(e);
  }
}
