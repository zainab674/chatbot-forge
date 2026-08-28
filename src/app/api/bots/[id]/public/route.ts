import { NextRequest, NextResponse } from 'next/server';
import { getPublicBot } from '@/lib/bot-service';
import { serverError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** GET /api/bots/:id/public — the theme + copy the chat UI needs. No secrets. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const bot = await getPublicBot(params.id);
    if (!bot) return NextResponse.json({ error: 'Chatbot not found.' }, { status: 404, headers: CORS });
    return NextResponse.json({ bot }, { headers: CORS });
  } catch (e) {
    return serverError(e, CORS);
  }
}
