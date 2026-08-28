import { NextRequest, NextResponse } from 'next/server';
import { bots, bookings } from '@/lib/mongodb';
import { serverError } from '@/lib/http';
import { resolveOwner, LOGIN_REQUIRED } from '@/lib/auth';
import type { BotDoc, BookingStatus } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES: BookingStatus[] = ['new', 'confirmed', 'cancelled'];

async function ownedBot(req: NextRequest, botId: string) {
  const ownerId = await resolveOwner(req);
  if (!ownerId) return { error: NextResponse.json({ error: LOGIN_REQUIRED }, { status: 401 }) };
  const col = await bots();
  const doc = (await col.findOne({ id: botId }, { projection: { _id: 0, id: 1, ownerId: 1 } })) as BotDoc | null;
  if (!doc || doc.ownerId !== ownerId) {
    return { error: NextResponse.json({ error: 'Chatbot not found.' }, { status: 404 }) };
  }
  return {};
}

/** PATCH /api/bots/:id/bookings/:bookingId — { status } */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; bookingId: string } }) {
  try {
    const owned = await ownedBot(req, params.id);
    if (owned.error) return owned.error;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }
    const status = body?.status as BookingStatus;
    if (!STATUSES.includes(status)) {
      return NextResponse.json({ error: `Status must be one of: ${STATUSES.join(', ')}.` }, { status: 400 });
    }

    const col = await bookings();
    const r = await col.updateOne({ id: params.bookingId, botId: params.id }, { $set: { status } });
    if (!r.matchedCount) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}

/** DELETE /api/bots/:id/bookings/:bookingId */
export async function DELETE(req: NextRequest, { params }: { params: { id: string; bookingId: string } }) {
  try {
    const owned = await ownedBot(req, params.id);
    if (owned.error) return owned.error;

    const col = await bookings();
    await col.deleteOne({ id: params.bookingId, botId: params.id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
