import { NextRequest, NextResponse } from 'next/server';
import { bots, sources as sourcesCollection } from '@/lib/mongodb';
import { decrypt } from '@/lib/crypto';
import { ingest, MAX_CRAWL_PAGES, type IngestInput } from '@/lib/knowledge/ingest';
import { MAX_FILE_BYTES, SUPPORTED_EXTENSIONS } from '@/lib/knowledge/extract';
import { assertPublicUrl } from '@/lib/knowledge/crawl';
import { readJsonObject, serverError } from '@/lib/http';
import { resolveOwner as ownerOf, isAnonOwner, LOGIN_REQUIRED } from '@/lib/auth';
import type { BotDoc, SourceDoc, SourceType } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Crawling a sitemap and embedding a few hundred chunks takes a while.
 *
 * 60 seconds is the ceiling on Netlify and cannot be raised there, so that is
 * the honest value. On a host that allows longer (Vercel Pro goes to 300) raise
 * this and `INGEST_BUDGET_MS` together; ingestion stops fetching a little
 * before the budget and indexes what it has, so the two must stay in step.
 */
export const maxDuration = 60;

async function loadOwned(req: NextRequest, botId: string) {
  const ownerId = await ownerOf(req);
  if (!ownerId) return { error: NextResponse.json({ error: LOGIN_REQUIRED }, { status: 401 }) };
  const col = await bots();
  const doc = (await col.findOne({ id: botId }, { projection: { _id: 0 } })) as BotDoc | null;
  if (!doc) return { error: NextResponse.json({ error: 'Chatbot not found.' }, { status: 404 }) };
  if (doc.ownerId !== ownerId) {
    return { error: NextResponse.json({ error: 'This chatbot belongs to another browser profile.' }, { status: 403 }) };
  }
  return { doc };
}

/** GET /api/bots/:id/sources — everything in this bot's knowledge base. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { doc, error } = await loadOwned(req, params.id);
    if (error) return error;

    const col = await sourcesCollection();
    const list = (await col
      // rawText is only needed server-side, and can be megabytes.
      .find({ botId: doc!.id }, { projection: { _id: 0, rawText: 0 } })
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray()) as SourceDoc[];

    return NextResponse.json({
      sources: list,
      totals: {
        sources: list.length,
        chunks: list.reduce((n, s) => n + (s.chunkCount ?? 0), 0),
        chars: list.reduce((n, s) => n + (s.chars ?? 0), 0),
      },
    });
  } catch (e) {
    return serverError(e);
  }
}

/**
 * POST /api/bots/:id/sources
 *
 * Accepts multipart/form-data for file uploads, or JSON for url, sitemap,
 * text and Q&A sources. Ingestion runs inline and the finished source comes
 * back in the response, so the UI can show status without polling.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { doc, error } = await loadOwned(req, params.id);
    if (error) return error;

    // Uploads and crawls consume storage and fetch bandwidth — account
    // territory. Drafts keep the info text and Q&A pairs, which cover the
    // trial experience.
    if (isAnonOwner(doc!.ownerId)) {
      return NextResponse.json(
        { error: 'Create a free account to upload documents or crawl websites. Drafts can use the info text and Q&A pairs meanwhile.' },
        { status: 403 },
      );
    }

    const contentType = req.headers.get('content-type') ?? '';
    let input: IngestInput;

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'No file was uploaded.' }, { status: 400 });
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: `That file is larger than the ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB limit.` },
          { status: 413 },
        );
      }
      const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
      if (!SUPPORTED_EXTENSIONS.includes(ext)) {
        return NextResponse.json(
          { error: `Unsupported file type "${ext || file.name}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}.` },
          { status: 415 },
        );
      }
      input = {
        type: 'file',
        title: (form.get('title') as string) || file.name,
        file: { name: file.name, buffer: Buffer.from(await file.arrayBuffer()) },
      };
    } else {
      const parsed = await readJsonObject(req);
      if ('error' in parsed) return parsed.error;
      const { body } = parsed;

      const type = String(body.type ?? '') as SourceType;
      if (!['url', 'sitemap', 'text', 'qa'].includes(type)) {
        return NextResponse.json({ error: `Unsupported source type "${type}".` }, { status: 400 });
      }

      if (type === 'url' || type === 'sitemap') {
        try {
          assertPublicUrl(String(body.url ?? ''));
        } catch (e: any) {
          return NextResponse.json({ error: e.message }, { status: 400 });
        }
      }

      input = {
        type,
        title: typeof body.title === 'string' ? body.title.slice(0, 200) : undefined,
        url: typeof body.url === 'string' ? body.url.trim() : undefined,
        followLinks: Boolean(body.followLinks),
        maxPages: Math.min(Number(body.maxPages) || 1, MAX_CRAWL_PAGES),
        text: typeof body.text === 'string' ? body.text : undefined,
        pairs: Array.isArray(body.pairs)
          ? body.pairs
              .slice(0, 500)
              .map((p: any) => ({ q: String(p?.q ?? '').slice(0, 1000), a: String(p?.a ?? '').slice(0, 8000) }))
          : undefined,
      };
    }

    let embeddingKey: string | null = null;
    if (doc!.embeddingKeyEnc) {
      try {
        embeddingKey = decrypt(doc!.embeddingKeyEnc);
      } catch {
        embeddingKey = null;
      }
    }
    if (!embeddingKey && doc!.apiKeyEnc) {
      try {
        embeddingKey = decrypt(doc!.apiKeyEnc);
      } catch {
        embeddingKey = null;
      }
    }

    const { source, warning } = await ingest(doc!, input, embeddingKey, req.signal);
    // rawText is kept server-side for re-chunking and can be hundreds of KB.
    const { rawText, ...summary } = source;
    return NextResponse.json(
      { source: summary, warning },
      { status: source.status === 'error' ? 422 : 201 },
    );
  } catch (e) {
    return serverError(e);
  }
}
