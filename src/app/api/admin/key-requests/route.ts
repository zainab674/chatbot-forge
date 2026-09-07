import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { readJsonObject, serverError } from '@/lib/http';
import { decideKeyRequest, listAllKeyRequests } from '@/lib/key-requests';
import { KEY_REQUEST_MAX_CHARS } from '@/lib/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Who has asked for a key, and answering them.
 *
 * A decision here is a record, not a grant: marking a request approved does not
 * put a platform key in place or move a single credit. The admin does that with
 * the panel's own controls — "Platform keys" or "Grant credits" — and then says
 * so here. One click in a list should never be able to hand out spend.
 */

/** GET — every request, newest first, with the number still waiting. */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin(req);
    if ('error' in guard) return guard.error;
    return NextResponse.json(await listAllKeyRequests());
  } catch (e) {
    return serverError(e);
  }
}

/** PATCH — { id, status, note } records a decision on one request. */
export async function PATCH(req: NextRequest) {
  try {
    const guard = await requireAdmin(req);
    if ('error' in guard) return guard.error;

    const parsed = await readJsonObject(req);
    if ('error' in parsed) return parsed.error;

    const id = typeof parsed.body.id === 'string' ? parsed.body.id.trim() : '';
    if (!id) return NextResponse.json({ error: 'Which request? Pass an id.' }, { status: 400 });

    const note = typeof parsed.body.note === 'string' ? parsed.body.note : '';
    if (note.length > KEY_REQUEST_MAX_CHARS) {
      return NextResponse.json({ error: `Keep the note under ${KEY_REQUEST_MAX_CHARS} characters.` }, { status: 400 });
    }

    const result = await decideKeyRequest(id, parsed.body.status, guard.admin.email, note);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ request: result.request });
  } catch (e) {
    return serverError(e);
  }
}
