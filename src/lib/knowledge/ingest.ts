/**
 * Ingestion: turn a source into stored, searchable chunks.
 *
 * Everything runs inside the request that created the source, with hard caps on
 * pages, characters and chunks. If embedding fails halfway, the chunks are
 * still written without vectors, so the source degrades to keyword search
 * rather than disappearing.
 */
import { sources as sourcesCollection, chunks as chunksCollection } from '../mongodb';
import { newId } from '../crypto';
import { chunkText, chunkQA } from './chunk';
import { extractFile } from './extract';
import { crawlUrl, crawlSitemap, type Page } from './crawl';
import { getEmbeddingProvider, embeddingBaseUrl, NO_EMBEDDINGS } from './embed';
import { embedTexts } from './embed-call';
import { termFrequencies } from './retrieve';
import type { BotDoc, ChunkDoc, SourceDoc, SourceType } from '../types';

/** Per-bot ceiling, so one creator cannot fill the database. */
export const MAX_CHARS_PER_BOT = 4_000_000;
export const MAX_CHARS_PER_SOURCE = 1_500_000;
export const MAX_CHUNKS_PER_SOURCE = 1500;
export const MAX_CRAWL_PAGES = 30;

/**
 * How long ingestion may spend fetching before it stops and indexes what it
 * has. Serverless hosts kill the function at a fixed wall clock that cannot be
 * raised (60 seconds on Netlify), and being killed mid-crawl saves nothing, so
 * the budget is deliberately set below it.
 */
export const INGEST_BUDGET_MS = (() => {
  const raw = Number(process.env.INGEST_BUDGET_MS);
  return Number.isFinite(raw) && raw > 5_000 ? raw : 240_000;
})();

export interface IngestInput {
  type: SourceType;
  title?: string;
  /** For type 'file'. */
  file?: { name: string; buffer: Buffer };
  /** For type 'url' and 'sitemap'. */
  url?: string;
  followLinks?: boolean;
  maxPages?: number;
  /** For type 'text'. */
  text?: string;
  /** For type 'qa'. */
  pairs?: { q: string; a: string }[];
}

export interface IngestResult {
  source: SourceDoc;
  warning?: string;
}

export async function ingest(
  bot: BotDoc,
  input: IngestInput,
  embeddingKey: string | null,
  signal?: AbortSignal,
): Promise<IngestResult> {
  const now = new Date().toISOString();
  const source: SourceDoc = {
    id: newId(),
    botId: bot.id,
    type: input.type,
    title: input.title?.trim() || defaultTitle(input),
    url: input.url ?? '',
    status: 'processing',
    error: '',
    warning: '',
    chars: 0,
    chunkCount: 0,
    pageCount: 0,
    rawText: '',
    createdAt: now,
    updatedAt: now,
  };

  const sourcesCol = await sourcesCollection();
  await sourcesCol.insertOne(source as any);

  const deadline = Date.now() + INGEST_BUDGET_MS;

  try {
    await assertQuota(bot.id);

    const pages = await gather(input, signal, deadline);
    const ranOutOfTime = Date.now() >= deadline;
    const totalChars = pages.reduce((n, p) => n + p.text.length, 0);
    if (!totalChars) throw new Error('No readable text was found in that source.');
    if (totalChars > MAX_CHARS_PER_SOURCE) {
      throw new Error(
        `That source is ${Math.round(totalChars / 1000)}k characters, over the ${Math.round(
          MAX_CHARS_PER_SOURCE / 1000,
        )}k per-source limit. Split it up and add the parts separately.`,
      );
    }

    // Chunk every page, tagging each chunk with where it came from.
    const pending: Omit<ChunkDoc, 'embedding'>[] = [];
    let truncated = false;
    for (const page of pages) {
      const pieces =
        input.type === 'qa' && input.pairs ? chunkQA(input.pairs) : chunkText(page.text);
      for (const piece of pieces) {
        if (pending.length >= MAX_CHUNKS_PER_SOURCE) {
          truncated = true;
          break;
        }
        pending.push({
          id: newId(),
          botId: bot.id,
          sourceId: source.id,
          index: pending.length,
          title: page.title || source.title,
          url: page.url || source.url,
          text: piece.text,
          terms: termFrequencies(piece.text),
          length: piece.text.length,
          createdAt: new Date().toISOString(),
        });
      }
    }

    if (!pending.length) throw new Error('That source produced no usable text.');

    const warnings: string[] = [];
    if (ranOutOfTime) {
      warnings.push(
        `Indexing stopped at the time limit with ${pages.length} page${pages.length === 1 ? '' : 's'} saved. Add the remaining pages as separate sources, or lower the page count.`,
      );
    }
    // Silent truncation reads as "we indexed everything" when we did not.
    if (truncated) {
      warnings.push(
        `Only the first ${MAX_CHUNKS_PER_SOURCE} chunks were indexed; the rest of this source is not searchable. Split it into smaller sources to index all of it.`,
      );
    }

    let vectors: number[][] | null = null;

    const provider =
      bot.embeddingProvider && bot.embeddingProvider !== NO_EMBEDDINGS
        ? getEmbeddingProvider(bot.embeddingProvider)
        : undefined;

    if (provider && bot.embeddingModel) {
      try {
        vectors = await embedTexts({
          provider,
          baseUrl: embeddingBaseUrl(bot, provider),
          apiKey: embeddingKey,
          model: bot.embeddingModel,
          input: pending.map((c) => c.text),
          signal,
        });
      } catch (e) {
        warnings.push(`Saved for keyword search, but embedding failed: ${(e as Error).message}`);
      }
    } else {
      warnings.push('Saved for keyword search. Add an embedding provider for semantic matching.');
    }

    const warning = warnings.length ? warnings.join(' ') : undefined;

    const docs: ChunkDoc[] = pending.map((c, i) => ({ ...c, embedding: vectors?.[i] ?? null }));
    const chunksCol = await chunksCollection();
    await chunksCol.insertMany(docs as any);

    const done: Partial<SourceDoc> = {
      status: 'ready',
      chars: totalChars,
      chunkCount: docs.length,
      pageCount: pages.length,
      title: source.title || pages[0]?.title || 'Untitled',
      error: '',
      warning: warning ?? '',
      updatedAt: new Date().toISOString(),
      // Small sources keep their text so re-syncing does not need a refetch.
      rawText: totalChars < 200_000 ? pages.map((p) => p.text).join('\n\n') : '',
    };
    await sourcesCol.updateOne({ id: source.id }, { $set: done });

    return { source: { ...source, ...done } as SourceDoc, warning };
  } catch (e) {
    const message = (e as Error).message || 'Ingestion failed.';
    await sourcesCol.updateOne(
      { id: source.id },
      { $set: { status: 'error', error: message.slice(0, 500), updatedAt: new Date().toISOString() } },
    );
    return { source: { ...source, status: 'error', error: message } };
  }
}

async function gather(input: IngestInput, signal?: AbortSignal, deadline?: number): Promise<Page[]> {
  switch (input.type) {
    case 'file': {
      if (!input.file) throw new Error('No file was uploaded.');
      const extracted = await extractFile(input.file.name, input.file.buffer);
      return [{ url: '', title: input.title || extracted.title || input.file.name, text: extracted.text }];
    }
    case 'url':
      if (!input.url) throw new Error('No URL given.');
      return crawlUrl(input.url, {
        maxPages: Math.min(input.maxPages ?? 1, MAX_CRAWL_PAGES),
        followLinks: Boolean(input.followLinks),
        signal,
        deadline,
      });
    case 'sitemap':
      if (!input.url) throw new Error('No sitemap URL given.');
      return crawlSitemap(input.url, {
        maxPages: Math.min(input.maxPages ?? 25, MAX_CRAWL_PAGES),
        signal,
        deadline,
      });
    case 'text':
      if (!input.text?.trim()) throw new Error('No text given.');
      return [{ url: '', title: input.title || 'Pasted text', text: input.text }];
    case 'qa': {
      const pairs = (input.pairs ?? []).filter((p) => p.q?.trim() && p.a?.trim());
      if (!pairs.length) throw new Error('No question and answer pairs given.');
      return [
        {
          url: '',
          title: input.title || 'Q&A',
          text: pairs.map((p) => `Q: ${p.q}\nA: ${p.a}`).join('\n\n'),
        },
      ];
    }
    default:
      throw new Error(`Unknown source type "${input.type}".`);
  }
}

function defaultTitle(input: IngestInput): string {
  if (input.file) return input.file.name;
  if (input.url) {
    try {
      const u = new URL(input.url);
      return u.hostname + (u.pathname === '/' ? '' : u.pathname);
    } catch {
      return input.url;
    }
  }
  return input.type === 'qa' ? 'Q&A' : 'Pasted text';
}

async function assertQuota(botId: string) {
  const col = await sourcesCollection();
  const existing = (await col.find({ botId }, { projection: { _id: 0, chars: 1 } }).limit(500).toArray()) as {
    chars: number;
  }[];
  const total = existing.reduce((n, s) => n + (s.chars ?? 0), 0);
  if (total >= MAX_CHARS_PER_BOT) {
    throw new Error(
      `This chatbot has reached its knowledge limit of ${Math.round(
        MAX_CHARS_PER_BOT / 1_000_000,
      )}M characters. Delete a source to make room.`,
    );
  }
}

/** Deletes a source and everything derived from it. */
export async function deleteSource(botId: string, sourceId: string): Promise<boolean> {
  const [sourcesCol, chunksCol] = await Promise.all([sourcesCollection(), chunksCollection()]);
  const existing = await sourcesCol.findOne({ id: sourceId, botId });
  if (!existing) return false;
  await chunksCol.deleteMany({ sourceId, botId });
  await sourcesCol.deleteOne({ id: sourceId, botId });
  return true;
}

/** Used when a bot is deleted, so no orphan chunks are left behind. */
export async function deleteAllKnowledge(botId: string): Promise<void> {
  const [sourcesCol, chunksCol] = await Promise.all([sourcesCollection(), chunksCollection()]);
  await Promise.all([chunksCol.deleteMany({ botId }), sourcesCol.deleteMany({ botId })]);
}
