import { NextRequest, NextResponse } from 'next/server';
import { bots } from '@/lib/mongodb';
import { encrypt, maskKey, newId } from '@/lib/crypto';
import { parseConfig } from '@/lib/validate';
import { readJsonObject, serverError } from '@/lib/http';
import { resolveOwner as ownerOf, isAnonOwner, LOGIN_REQUIRED, SIGNUP_FOR_KEYS } from '@/lib/auth';
import { consume, clientKey, PER_CREATE } from '@/lib/ratelimit';
import { sweepStaleAnonDrafts } from '@/lib/drafts';
import type { BotDoc } from '@/lib/types';

/** Drafts one browser id may hold before we insist on an account. */
const MAX_ANON_DRAFTS = 10;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/bots — every chatbot belonging to the caller. */
export async function GET(req: NextRequest) {
  const ownerId = await ownerOf(req);
  if (!ownerId) return NextResponse.json({ error: LOGIN_REQUIRED }, { status: 401 });

  try {
    const col = await bots();
    const docs = await col
      .find({ ownerId }, { projection: { _id: 0, apiKeyEnc: 0, embeddingKeyEnc: 0 } })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    return NextResponse.json({ bots: docs });
  } catch (e) {
    return serverError(e);
  }
}

/** POST /api/bots — create a chatbot. Anonymous browsers may create drafts. */
export async function POST(req: NextRequest) {
  const ownerId = await ownerOf(req);
  if (!ownerId) return NextResponse.json({ error: LOGIN_REQUIRED }, { status: 401 });
  const anon = isAnonOwner(ownerId);

  // Account-less creation is a spam vector, so it gets a per-IP limit.
  if (anon) {
    const limit = await consume(`create:${clientKey(req.headers)}`, PER_CREATE);
    if (!limit.ok) {
      return NextResponse.json(
        { error: 'Too many chatbots created too quickly. Give it a moment.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      );
    }
  }

  const parsed = await readJsonObject(req);
  if ('error' in parsed) return parsed.error;
  const { body } = parsed;

  const { config, error } = parseConfig(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  try {
    // Encryption is inside the try: it throws when ENCRYPTION_SECRET is missing
    // or too short, which is a configuration problem, not a crash.
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const embeddingKey = typeof body.embeddingKey === 'string' ? body.embeddingKey.trim() : '';

    // The line that must not move: keys live on accounts only.
    if (anon && (apiKey || embeddingKey)) {
      return NextResponse.json({ error: SIGNUP_FOR_KEYS }, { status: 403 });
    }

    if (anon) {
      const col = await bots();
      const held = await col.countDocuments({ ownerId });
      if (held >= MAX_ANON_DRAFTS) {
        return NextResponse.json(
          { error: `This browser already holds ${MAX_ANON_DRAFTS} draft chatbots. Sign up (free) to keep them and create more.` },
          { status: 403 },
        );
      }
      // Piggyback the sweep of long-abandoned drafts on creation traffic.
      sweepStaleAnonDrafts().catch(() => {});
    }

    const now = new Date().toISOString();

    const doc: BotDoc = {
      ...config,
      id: newId(),
      ownerId,
      apiKeyEnc: apiKey ? encrypt(apiKey) : null,
      apiKeyMask: apiKey ? maskKey(apiKey) : '',
      embeddingKeyEnc: embeddingKey ? encrypt(embeddingKey) : null,
      embeddingKeyMask: embeddingKey ? maskKey(embeddingKey) : '',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
    };

    const col = await bots();
    await col.insertOne(doc as any);
    const { apiKeyEnc, embeddingKeyEnc, ...safe } = doc;
    return NextResponse.json({ bot: safe }, { status: 201 });
  } catch (e) {
    return serverError(e);
  }
}
