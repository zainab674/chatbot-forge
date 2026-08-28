import { NextRequest, NextResponse } from 'next/server';
import { bots } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin';
import { serverError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/bots/:id — { isPublic }
 *
 * The abuse lever: pausing a bot takes it offline everywhere (chat, embeds,
 * widget, bookings) without touching the owner's configuration.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const guard = await requireAdmin(req);
    if ('error' in guard) return guard.error;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }
    if (typeof body?.isPublic !== 'boolean') {
      return NextResponse.json({ error: 'Pass isPublic as a boolean.' }, { status: 400 });
    }

    const col = await bots();
    const r = await col.updateOne({ id: params.id }, { $set: { isPublic: body.isPublic } });
    if (!r.matchedCount) return NextResponse.json({ error: 'Bot not found.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
