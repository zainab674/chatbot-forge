import { NextRequest, NextResponse } from 'next/server';
import { users } from '@/lib/mongodb';
import { consume, clientKey, PER_AUTH } from '@/lib/ratelimit';
import { consumeToken } from '@/lib/reset';
import { serverError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/verify — { token }. Marks the address confirmed. */
export async function POST(req: NextRequest) {
  const limit = await consume(`verify:${clientKey(req.headers)}`, PER_AUTH);
  if (!limit.ok) {
    return NextResponse.json({ error: 'Too many attempts. Give it a few minutes.' }, { status: 429 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    const check = await consumeToken(typeof body?.token === 'string' ? body.token : '', 'verify');
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

    const col = await users();
    await col.updateOne({ id: check.userId! }, { $set: { emailVerifiedAt: new Date().toISOString() } });
    return NextResponse.json({ ok: true, email: check.email });
  } catch (e) {
    return serverError(e);
  }
}
