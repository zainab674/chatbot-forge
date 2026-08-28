import { NextRequest, NextResponse } from 'next/server';

/**
 * Reads a JSON object body, or returns the 400 to send back.
 *
 * Every route needs this: `req.json()` throws on malformed input, and a body of
 * `null` or `[]` parses fine but then blows up on the first property access,
 * which surfaces as a 500 with the internal error text in it.
 */
export async function readJsonObject(
  req: NextRequest,
  headers: Record<string, string> = {},
): Promise<{ body: Record<string, any> } | { error: NextResponse }> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return { error: NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400, headers }) };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: NextResponse.json({ error: 'Expected a JSON object.' }, { status: 400, headers }) };
  }
  return { body: parsed as Record<string, any> };
}

/**
 * Turns an unexpected exception into a 500 without echoing internals.
 *
 * Configuration problems the operator can fix are worth surfacing, so a small
 * allow-list of known messages passes through; everything else is logged and
 * replaced with a generic line.
 */
export function serverError(e: unknown, headers: Record<string, string> = {}): NextResponse {
  const message = e instanceof Error ? e.message : String(e);
  const safe =
    /MONGODB_URI|ENCRYPTION_SECRET|not set|could not be decrypted/i.test(message)
      ? message
      : 'Something went wrong on the server.';
  if (safe !== message) console.error('[chatbot-forge]', e);
  return NextResponse.json({ error: safe }, { status: 500, headers });
}
