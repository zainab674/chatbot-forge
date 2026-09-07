import { NextRequest, NextResponse } from 'next/server';
import { users } from '@/lib/mongodb';
import { sessionOf, sessionRevoked } from '@/lib/auth';
import { readJsonObject, serverError } from '@/lib/http';
import { consume, clientKey } from '@/lib/ratelimit';
import { createKeyRequest, listKeyRequestsFor } from '@/lib/key-requests';
import { KEY_REQUEST_MAX_CHARS } from '@/lib/platform';
import { notifyAdminsOfKeyRequest } from '@/lib/notify';
import type { UserDoc } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Asking the admin for a key, and seeing what came of it.
 *
 * Accounts only. An anonymous draft has no address to answer and no balance to
 * top up, so there is nothing for an admin to act on — the builder sends those
 * visitors to signup instead, which is the same line every other key-shaped
 * surface in the app draws.
 */

/** The signed-in account, or the 401 to send back. */
async function requireUser(req: NextRequest): Promise<{ user: UserDoc } | { error: NextResponse }> {
  const session = sessionOf(req);
  const unauthorized = { error: NextResponse.json({ error: 'Log in to ask for a key.' }, { status: 401 }) };
  if (!session) return unauthorized;

  const user = await (await users()).findOne({ id: session.userId });
  if (!user || user.deletedAt || sessionRevoked(session, user)) return unauthorized;
  return { user };
}

/** GET — this account's own requests, newest first. */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireUser(req);
    if ('error' in guard) return guard.error;
    return NextResponse.json({ requests: await listKeyRequestsFor(guard.user.id) });
  } catch (e) {
    return serverError(e);
  }
}

/** POST — { provider, model, reason } files one request. */
export async function POST(req: NextRequest) {
  try {
    const guard = await requireUser(req);
    if ('error' in guard) return guard.error;

    // Per IP as well as the per-account cap in createKeyRequest: the cap stops
    // one account flooding the list, this stops one machine registering
    // accounts to do the same thing.
    const limit = await consume(`keyreq:${clientKey(req.headers)}`, { max: 10, windowSec: 3_600 });
    if (!limit.ok) {
      return NextResponse.json(
        { error: 'Too many requests just now. Try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      );
    }

    const parsed = await readJsonObject(req);
    if ('error' in parsed) return parsed.error;

    const reason = typeof parsed.body.reason === 'string' ? parsed.body.reason : '';
    if (reason.length > KEY_REQUEST_MAX_CHARS) {
      return NextResponse.json({ error: `Keep it under ${KEY_REQUEST_MAX_CHARS} characters.` }, { status: 400 });
    }

    const result = await createKeyRequest(guard.user, {
      provider: typeof parsed.body.provider === 'string' ? parsed.body.provider : '',
      model: typeof parsed.body.model === 'string' ? parsed.body.model : '',
      reason,
    });
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

    // The request is already stored; the email is a nudge on top of it, so a
    // mailer failure must not turn a filed request into an error the creator
    // sees and retries.
    await notifyAdminsOfKeyRequest(req, result.request).catch((e) =>
      console.warn('[chatbot-forge] could not email the admins about a key request:', (e as Error)?.message),
    );

    return NextResponse.json({ request: result.request }, { status: 201 });
  } catch (e) {
    return serverError(e);
  }
}
