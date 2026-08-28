import { NextRequest, NextResponse } from 'next/server';
import { bots } from '@/lib/mongodb';
import { resolveOwner, LOGIN_REQUIRED } from '@/lib/auth';
import { listTranscripts, getTranscript, deleteTranscripts } from '@/lib/transcripts';
import { serverError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Transcripts for one bot. Owner only — these are the messages the bot's
 * visitors typed, and the ownership check is the only thing keeping them from
 * anyone who knows a bot id.
 */
async function requireOwner(req: NextRequest, botId: string) {
  const ownerId = await resolveOwner(req);
  if (!ownerId) return { error: NextResponse.json({ error: LOGIN_REQUIRED }, { status: 401 }) };
  const doc = await (await bots()).findOne({ id: botId }, { projection: { _id: 0, apiKeyEnc: 0 } });
  if (!doc) return { error: NextResponse.json({ error: 'Chatbot not found.' }, { status: 404 }) };
  if (doc.ownerId !== ownerId) {
    return { error: NextResponse.json({ error: 'That chatbot belongs to someone else.' }, { status: 403 }) };
  }
  return { doc };
}

/** GET — the list, or one transcript with `?conversation=<id>`. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const guard = await requireOwner(req, params.id);
    if ('error' in guard) return guard.error;

    const one = req.nextUrl.searchParams.get('conversation');
    if (one) {
      const transcript = await getTranscript(params.id, one);
      if (!transcript) return NextResponse.json({ error: 'No such conversation.' }, { status: 404 });
      return NextResponse.json({ conversation: transcript });
    }

    return NextResponse.json({
      logging: Boolean(guard.doc.logConversations),
      retentionDays: guard.doc.logRetentionDays ?? 30,
      conversations: await listTranscripts(params.id),
    });
  } catch (e) {
    return serverError(e);
  }
}

/** DELETE — erase every stored transcript for this bot. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const guard = await requireOwner(req, params.id);
    if ('error' in guard) return guard.error;
    return NextResponse.json({ ok: true, deleted: await deleteTranscripts(params.id) });
  } catch (e) {
    return serverError(e);
  }
}
