import { NextRequest, NextResponse } from 'next/server';
import { bots, bookings } from '@/lib/mongodb';
import { encrypt, maskKey } from '@/lib/crypto';
import { parseConfig } from '@/lib/validate';
import { readJsonObject, serverError } from '@/lib/http';
import { deleteAllKnowledge } from '@/lib/knowledge/ingest';
import { deleteTranscripts } from '@/lib/transcripts';
import { resolveOwner as ownerOf, isAnonOwner, LOGIN_REQUIRED, SIGNUP_FOR_KEYS } from '@/lib/auth';
import type { BotDoc } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function loadOwned(req: NextRequest, id: string) {
  const ownerId = await ownerOf(req);
  if (!ownerId) return { error: NextResponse.json({ error: LOGIN_REQUIRED }, { status: 401 }) };
  const col = await bots();
  const doc = await col.findOne({ id }, { projection: { _id: 0 } });
  if (!doc) return { error: NextResponse.json({ error: 'Chatbot not found.' }, { status: 404 }) };
  if (doc.ownerId !== ownerId) {
    return { error: NextResponse.json({ error: 'This chatbot belongs to another browser profile.' }, { status: 403 }) };
  }
  return { doc: doc as BotDoc, col, ownerId };
}

/** GET /api/bots/:id — full config for the owner's editor (never the raw key). */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { doc, error } = await loadOwned(req, params.id);
    if (error) return error;
    const { apiKeyEnc, embeddingKeyEnc, ...safe } = doc!;
    return NextResponse.json({
      bot: safe,
      hasKey: Boolean(apiKeyEnc),
      hasEmbeddingKey: Boolean(embeddingKeyEnc),
    });
  } catch (e) {
    return serverError(e);
  }
}

/** PATCH /api/bots/:id — update. Omit `apiKey` to keep the stored one. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { doc, col, ownerId, error } = await loadOwned(req, params.id);
    if (error) return error;

    const parsed = await readJsonObject(req);
    if ('error' in parsed) return parsed.error;
    const { body } = parsed;

    // Keys live on accounts only — an anonymous draft cannot store one.
    const sendsKey =
      (typeof body.apiKey === 'string' && body.apiKey.trim()) ||
      (typeof body.embeddingKey === 'string' && body.embeddingKey.trim());
    if (isAnonOwner(ownerId) && sendsKey) {
      return NextResponse.json({ error: SIGNUP_FOR_KEYS }, { status: 403 });
    }

    const { config, error: invalid } = parseConfig(body, doc!);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const update: Partial<BotDoc> = { ...config, updatedAt: new Date().toISOString() };

    if (typeof body.apiKey === 'string') {
      const trimmed = body.apiKey.trim();
      if (trimmed) {
        update.apiKeyEnc = encrypt(trimmed);
        update.apiKeyMask = maskKey(trimmed);
      } else if (body.clearApiKey === true) {
        update.apiKeyEnc = null;
        update.apiKeyMask = '';
      }
    }

    if (typeof body.embeddingKey === 'string') {
      const trimmed = body.embeddingKey.trim();
      if (trimmed) {
        update.embeddingKeyEnc = encrypt(trimmed);
        update.embeddingKeyMask = maskKey(trimmed);
      } else if (body.clearEmbeddingKey === true) {
        update.embeddingKeyEnc = null;
        update.embeddingKeyMask = '';
      }
    }

    await col!.updateOne({ id: params.id }, { $set: update });

    // Turning logging off means "stop keeping these", not "keep the old ones
    // forever" — anything else makes the switch a lie.
    if (doc!.logConversations && update.logConversations === false) {
      await deleteTranscripts(params.id).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}

/** DELETE /api/bots/:id */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { col, error } = await loadOwned(req, params.id);
    if (error) return error;
    await col!.deleteOne({ id: params.id });
    // Sources, chunks, bookings and transcripts would otherwise be orphaned in
    // the database — and transcripts especially should not outlive the bot
    // whose visitors wrote them.
    await deleteAllKnowledge(params.id);
    await (await bookings()).deleteMany({ botId: params.id });
    await deleteTranscripts(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
