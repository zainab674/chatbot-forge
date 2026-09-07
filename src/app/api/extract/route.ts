import { NextRequest, NextResponse } from 'next/server';
import { extractFile, MAX_FILE_BYTES, SUPPORTED_EXTENSIONS } from '@/lib/knowledge/extract';
import { consume, clientKey, PER_EXPENSIVE } from '@/lib/ratelimit';
import { declaredTooLarge, serverError } from '@/lib/http';
import { LIMITS } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/extract — file in, plain text out.
 *
 * The builder's info box accepts a document instead of a paste. Deliberately
 * stateless: nothing is stored, no embeddings are computed and no model is
 * called, so the text is only ever what the parser found. That is also why it
 * needs no account, unlike /api/bots/:id/sources, which does all three.
 */
export async function POST(req: NextRequest) {
  const fail = (message: string, status: number) => NextResponse.json({ error: message }, { status });

  // Parsing a big PDF is the expensive part, so the bucket is per IP and
  // shared with nothing else.
  const limit = await consume(`extract:${clientKey(req.headers)}`, PER_EXPENSIVE);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many uploads in a row. Give it a moment.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  try {
    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return fail('Send the file as multipart/form-data.', 415);
    }

    // Before the body is read, not after: this endpoint needs no account, so
    // whatever arrives here arrives from anyone.
    if (declaredTooLarge(req, MAX_FILE_BYTES)) {
      return fail(`That file is larger than the ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB limit.`, 413);
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail('No file was uploaded.', 400);
    if (file.size === 0) return fail('That file is empty.', 400);
    if (file.size > MAX_FILE_BYTES) {
      return fail(`That file is larger than the ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB limit.`, 413);
    }

    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      return fail(`Unsupported file type "${ext || file.name}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}.`, 415);
    }

    let extracted;
    try {
      extracted = await extractFile(file.name, Buffer.from(await file.arrayBuffer()));
    } catch (e: any) {
      // Parser failures are about the file, not the server: a scanned PDF or a
      // corrupt docx should read as a 400 the uploader can act on.
      return fail(e?.message ?? 'Could not read that file.', 400);
    }

    const full = extracted.text.trim();
    if (!full) return fail('No text found in that file.', 400);

    // The info field is capped at LIMITS.info, so trim here rather than let the
    // save silently drop the tail.
    const text = full.slice(0, LIMITS.info);

    return NextResponse.json({
      text,
      title: extracted.title,
      pages: extracted.pages,
      chars: full.length,
      truncated: full.length > text.length,
    });
  } catch (e) {
    return serverError(e);
  }
}
