import { NextRequest, NextResponse } from 'next/server';
import { bots } from '@/lib/mongodb';
import { deleteSource } from '@/lib/knowledge/ingest';
import { serverError } from '@/lib/http';
import { resolveOwner as ownerOf, LOGIN_REQUIRED } from '@/lib/auth';
import type { BotDoc } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** DELETE /api/bots/:id/sources/:sourceId — removes the source and its chunks. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string; sourceId: string } }) {
  try {
    const ownerId = await ownerOf(req);
    if (!ownerId) return NextResponse.json({ error: LOGIN_REQUIRED }, { status: 401 });

    const col = await bots();
    const doc = (await col.findOne({ id: params.id }, { projection: { _id: 0 } })) as BotDoc | null;
    if (!doc) return NextResponse.json({ error: 'Chatbot not found.' }, { status: 404 });
    if (doc.ownerId !== ownerId) {
      return NextResponse.json({ error: 'This chatbot belongs to another browser profile.' }, { status: 403 });
    }

    const removed = await deleteSource(params.id, params.sourceId);
    if (!removed) return NextResponse.json({ error: 'Source not found.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
