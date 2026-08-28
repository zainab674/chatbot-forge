import { assertReachableEndpoint } from '../net-guard';
import { EmbeddingError, normalise, type EmbedArgs } from './embed';

/**
 * Calling an embedding endpoint.
 *
 * Server-only, and separated from ./embed for that reason: the provider
 * catalogue next door is rendered by the builder UI, while this half resolves
 * DNS to check where a creator's custom endpoint actually points.
 */

/** Providers cap batch size; 96 is comfortably under every one of them. */
const BATCH = 64;

export async function embedTexts(args: EmbedArgs): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < args.input.length; i += BATCH) {
    out.push(...(await embedBatch({ ...args, input: args.input.slice(i, i + BATCH) })));
  }
  return out;
}

async function embedBatch(a: EmbedArgs): Promise<number[][]> {
  const baseUrl = (a.baseUrl || a.provider.baseUrl).replace(/\/$/, '');
  if (!baseUrl) throw new EmbeddingError('No embedding endpoint configured.', 400);

  // A creator-supplied endpoint gets the crawler's SSRF checks: this is a URL
  // from a bot document being handed to fetch, which is the same shape of hole
  // as pasting a URL into the knowledge base.
  if (baseUrl !== a.provider.baseUrl.replace(/\/$/, '')) {
    try {
      await assertReachableEndpoint(baseUrl);
    } catch (e) {
      throw new EmbeddingError(`Custom embedding endpoint rejected: ${(e as Error).message}`, 400);
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (a.apiKey) headers.Authorization = `Bearer ${a.apiKey}`;

  const res = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers,
    signal: a.signal,
    // A custom endpoint must not redirect the request onto an internal address
    // the check above never saw.
    redirect: baseUrl === a.provider.baseUrl.replace(/\/$/, '') ? 'follow' : 'error',
    body: JSON.stringify({
      model: a.model,
      input: a.input,
      // Ignored by providers that do not use it.
      encoding_format: 'float',
    }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.text();
      try {
        const json = JSON.parse(body);
        detail = json?.error?.message ?? json?.message ?? body;
      } catch {
        detail = body;
      }
    } catch {
      /* ignore */
    }
    detail = String(detail).slice(0, 300);
    if (res.status === 401 || res.status === 403) {
      throw new EmbeddingError(`The embedding provider rejected the API key. ${detail}`, res.status);
    }
    if (res.status === 404) {
      throw new EmbeddingError(`Embedding model "${a.model}" not found at that endpoint. ${detail}`, 404);
    }
    throw new EmbeddingError(`Embedding request failed (${res.status}). ${detail}`, res.status);
  }

  const json = await res.json();
  const rows: any[] = json?.data ?? [];
  if (!Array.isArray(rows) || rows.length !== a.input.length) {
    throw new EmbeddingError('The embedding provider returned an unexpected response shape.');
  }
  // Some providers do not preserve input order; `index` is authoritative.
  const sorted = [...rows].sort((x, y) => (x.index ?? 0) - (y.index ?? 0));
  return sorted.map((r) => {
    const v = r.embedding;
    if (!Array.isArray(v) || !v.length) throw new EmbeddingError('Empty embedding returned.');
    return normalise(v as number[]);
  });
}
