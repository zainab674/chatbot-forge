import { NextRequest, NextResponse } from 'next/server';
import { bots, bookings } from '@/lib/mongodb';
import { newId } from '@/lib/crypto';
import { originAllowed, effectiveOrigin } from '@/lib/validate';
import { rateLimit, clientKey } from '@/lib/ratelimit';
import { notifyOwnerOfBooking } from '@/lib/notify';
import type { BotDoc, BookingDoc } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Embed-Origin',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** How long a booking is kept. Documented on /privacy, so keep the two in step. */
function retentionDays(): number {
  const raw = parseInt(process.env.BOOKING_RETENTION_DAYS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 365;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * POST /api/book/:id — { name, contact, when?, note? }
 *
 * Public, like chat: anyone the bot is visible to can request an appointment.
 * Same origin allow-list and rate limits as chat, so a booking form cannot be
 * used to spam a bot that is otherwise locked to one domain.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const fail = (message: string, status: number) =>
    NextResponse.json({ error: message }, { status, headers: CORS });

  let doc: BotDoc | null = null;
  try {
    const col = await bots();
    doc = (await col.findOne({ id: params.id }, { projection: { _id: 0 } })) as BotDoc | null;
  } catch (e) {
    console.error('[chatbot-forge] booking lookup failed:', e);
    return fail('Something went wrong on the server.', 500);
  }

  if (!doc) return fail('Chatbot not found.', 404);
  if (!doc.isPublic) return fail('This chatbot is paused by its owner.', 403);
  if (!doc.bookingEnabled) return fail('This chatbot does not take bookings.', 403);

  const selfHost = req.headers.get('host');
  const origin = effectiveOrigin(req.headers.get('origin'), req.headers.get('x-embed-origin'), selfHost);
  if (!originAllowed(doc.allowedOrigins ?? [], origin, selfHost)) {
    return fail('This chatbot is not allowed to run on this domain.', 403);
  }

  // Its own bucket: booking traffic must not spend the chatbot's chat allowance.
  const limit = await rateLimit(doc.id, clientKey(req.headers), 'book');
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many requests. Give it a moment.' },
      { status: 429, headers: { ...CORS, 'Retry-After': String(limit.retryAfter) } },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail('Invalid JSON body.', 400);
  }

  // Control and formatting characters are collapsed, not merely trimmed off the
  // ends: `name` is interpolated into an email subject line by the owner
  // notification, and a subject is one line whether or not the value agrees.
  const str = (v: unknown, max: number) =>
    typeof v === 'string' ? v.replace(/\p{C}+/gu, ' ').trim().slice(0, max) : '';
  const name = str(body?.name, 100);
  const contact = str(body?.contact, 200);
  const when = str(body?.when, 200);
  const note = str(body?.note, 1_000);

  if (!name) return fail('Add your name.', 400);
  if (!contact) return fail('Add an email or phone number so they can get back to you.', 400);

  try {
    const booking: BookingDoc = {
      id: newId(),
      botId: doc.id,
      name,
      contact,
      when,
      note,
      status: 'new',
      createdAt: new Date().toISOString(),
      // Personal data with an end date. A year by default, because a booking
      // is a business record for a while and then it is just a stranger's
      // phone number sitting in a database.
      expiresAt: new Date(Date.now() + retentionDays() * 86_400_000),
    };
    const col = await bookings();
    await col.insertOne(booking as any);

    // Not awaited: a booking that is safely stored must not fail because an
    // email provider is slow, and the request the visitor is waiting on should
    // not carry that latency either. It still lands in the manage screen.
    notifyOwnerOfBooking(req, doc, booking).catch((e) =>
      console.error('[chatbot-forge] booking notification failed:', e),
    );

    return NextResponse.json({ ok: true }, { status: 201, headers: CORS });
  } catch (e) {
    console.error('[chatbot-forge] booking insert failed:', e);
    return fail('Could not save the booking. Try again.', 500);
  }
}
