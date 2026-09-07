/**
 * Retrieval.
 *
 * Hybrid by default: semantic similarity finds "how much does it cost" in a
 * chunk that says "pricing starts at $12", and BM25 keyword scoring catches the
 * exact product codes, names and numbers that embeddings routinely blur. The
 * two rankings are merged with reciprocal rank fusion, which needs no score
 * calibration between them.
 *
 * Vector search runs through Atlas `$vectorSearch` when MONGODB_VECTOR_INDEX is
 * set, and falls back to an in-process dot product otherwise, so the feature
 * works on a plain local mongod too.
 */
import { chunks as chunksCollection } from '../mongodb';
import { getEmbeddingProvider, embeddingBaseUrl, dot, NO_EMBEDDINGS } from './embed';
import { embedTexts } from './embed-call';
import type { BotDoc, ChunkDoc, Citation } from '../types';

export interface Retrieved {
  chunk: ChunkDoc;
  score: number;
}

export interface RetrieveArgs {
  bot: BotDoc;
  query: string;
  embeddingKey: string | null;
  topK?: number;
  signal?: AbortSignal;
}

/** Chunks pulled into memory for the keyword pass and the non-Atlas vector pass. */
const MAX_SCAN = 4000;

const STOPWORDS = new Set(
  ('a an and are as at be but by can could do does for from had has have how i if in into is it its may me my of on or our ' +
    'should so than that the their them then there these they this to was we were what when where which who why will with ' +
    'would you your please tell about get give want need')
    .split(' '),
);

/**
 * Light suffix stripping, applied to both the stored text and the query so they
 * meet in the middle. Without it "refunds" never matches a document that only
 * says "refund", which is exactly the kind of miss that makes keyword search
 * feel broken. Deliberately conservative: it is better to under-stem than to
 * collapse two words that mean different things.
 */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`; // policies -> policy
  if (w.length > 4 && w.endsWith('sses')) return w.slice(0, -2); // classes -> class
  if (w.length > 3 && w.endsWith('es') && /(ch|sh|x|z|s)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1); // refunds -> refund
  if (w.length > 5 && w.endsWith('ing')) {
    const base = w.slice(0, -3);
    if (base.length > 2) return dedupe(base);
  }
  if (w.length > 4 && w.endsWith('ied')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith('ed')) {
    const base = w.slice(0, -2);
    if (base.length > 2) return dedupe(base);
  }
  return w;
}

/** "shipp" -> "ship", "runn" -> "run" after stripping -ing/-ed. */
function dedupe(base: string): string {
  return /([^aeiou])\1$/.test(base) && !/(ll|ss|ff|zz)$/.test(base) ? base.slice(0, -1) : base;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? [])
    .map((t) => t.replace(/['’]s$/, ''))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem)
    .filter((t) => t.length > 1);
}

/** Term frequency map stored on each chunk at write time. */
export function termFrequencies(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tokenize(text)) out[t] = (out[t] ?? 0) + 1;
  return out;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                              */
/* ------------------------------------------------------------------ */

const K1 = 1.4;
const B = 0.75;

export function bm25(query: string, docs: { terms: Record<string, number>; length: number }[]): number[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (!queryTerms.length || !docs.length) return docs.map(() => 0);

  const avgLen = docs.reduce((s, d) => s + (d.length || 1), 0) / docs.length;
  const df: Record<string, number> = {};
  for (const term of queryTerms) {
    df[term] = docs.reduce((n, d) => n + (d.terms?.[term] ? 1 : 0), 0);
  }

  return docs.map((d) => {
    let score = 0;
    for (const term of queryTerms) {
      const f = d.terms?.[term] ?? 0;
      if (!f) continue;
      const n = df[term];
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      const norm = f * (K1 + 1);
      const denom = f + K1 * (1 - B + (B * (d.length || 1)) / avgLen);
      score += idf * (norm / denom);
    }
    return score;
  });
}

/**
 * Reciprocal rank fusion. Rank-based, so a keyword score of 14.2 and a cosine
 * of 0.83 can be combined without pretending they are the same unit.
 */
export function fuse(rankings: number[][], weights: number[], k = 60): number[] {
  // Longest wins, so a short ranking cannot leave trailing entries undefined
  // and turn every later addition into NaN.
  const size = rankings.reduce((n, r) => Math.max(n, r.length), 0);
  const scores = new Array(size).fill(0);
  rankings.forEach((scoreList, r) => {
    const order = scoreList
      .map((score, i) => ({ score, i }))
      .sort((a, b) => b.score - a.score);
    order.forEach(({ score, i }, rank) => {
      if (score <= 0) return;
      scores[i] += (weights[r] ?? 1) / (k + rank + 1);
    });
  });
  return scores;
}

/* ------------------------------------------------------------------ */
/* Retrieval                                                            */
/* ------------------------------------------------------------------ */

export async function retrieve(args: RetrieveArgs): Promise<Retrieved[]> {
  const { bot, query } = args;
  const topK = args.topK ?? bot.retrievalTopK ?? 5;
  if (!query.trim() || topK <= 0) return [];

  const col = await chunksCollection();

  let queryVector: number[] | null = null;
  const provider =
    bot.embeddingProvider && bot.embeddingProvider !== NO_EMBEDDINGS
      ? getEmbeddingProvider(bot.embeddingProvider)
      : undefined;

  if (provider && bot.embeddingModel) {
    try {
      const [vec] = await embedTexts({
        provider,
        baseUrl: embeddingBaseUrl(bot, provider),
        apiKey: args.embeddingKey,
        model: bot.embeddingModel,
        input: [query],
        signal: args.signal,
      });
      queryVector = vec ?? null;
    } catch (e) {
      // Retrieval degrading to keyword-only beats the whole chat failing.
      console.warn('[chatbot-forge] query embedding failed, using keyword search:', (e as Error).message);
    }
  }

  // Atlas vector index, when one is configured.
  const indexName = process.env.MONGODB_VECTOR_INDEX;
  if (queryVector && indexName) {
    try {
      const atlas = await (col as any)
        .aggregate([
          {
            $vectorSearch: {
              index: indexName,
              path: 'embedding',
              queryVector,
              numCandidates: Math.max(100, topK * 20),
              limit: topK * 3,
              filter: { botId: bot.id },
            },
          },
          { $addFields: { _score: { $meta: 'vectorSearchScore' } } },
          { $project: { _id: 0 } },
        ])
        .toArray();

      if (atlas.length) {
        const keyword = bm25(query, atlas);
        const vectorScores = atlas.map((d: any) => d._score ?? 0);
        const fused = fuse([vectorScores, keyword], [1, 0.5]);
        return atlas
          .map((chunk: ChunkDoc, i: number) => ({ chunk, score: fused[i] }))
          .sort((a: Retrieved, b: Retrieved) => b.score - a.score)
          .slice(0, topK);
      }
    } catch (e) {
      console.warn('[chatbot-forge] $vectorSearch unavailable, scoring in process:', (e as Error).message);
    }
  }

  // In-process path: load this bot's chunks and score them here.
  //
  // Embeddings come along only when there is a query vector to compare them
  // against. A keyword-only bot — the default, since Groq serves no embedding
  // endpoint — was otherwise pulling thousands of 1536-float arrays out of the
  // database on every message purely to ignore every one of them.
  const projection: Record<string, 0> = queryVector ? { _id: 0 } : { _id: 0, embedding: 0 };
  const docs = (await col
    .find({ botId: bot.id }, { projection })
    .limit(MAX_SCAN)
    .toArray()) as ChunkDoc[];
  if (!docs.length) return [];

  const keyword = bm25(query, docs);
  const vector = queryVector
    ? docs.map((d) => (d.embedding ? dot(queryVector!, d.embedding) : 0))
    : null;

  const fused = vector ? fuse([vector, keyword], [1, 0.5]) : keyword;

  return docs
    .map((chunk, i) => ({ chunk, score: fused[i] }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/* ------------------------------------------------------------------ */
/* Turning results into prompt context + citations                      */
/* ------------------------------------------------------------------ */

export interface Context {
  block: string;
  citations: Citation[];
}

/** Caps the context so a big topK cannot blow past the model's window. */
const MAX_CONTEXT_CHARS = 12_000;

export function buildContext(results: Retrieved[]): Context {
  const citations: Citation[] = [];
  const parts: string[] = [];
  let used = 0;

  results.forEach(({ chunk }) => {
    if (used + chunk.text.length > MAX_CONTEXT_CHARS) return;
    const n = citations.length + 1;
    used += chunk.text.length;
    parts.push(`[${n}] ${chunk.title || 'Untitled'}${chunk.url ? ` (${chunk.url})` : ''}\n${chunk.text}`);
    citations.push({
      n,
      title: chunk.title || 'Untitled',
      url: chunk.url || '',
      snippet: chunk.text.slice(0, 240).replace(/\s+/g, ' ').trim(),
      sourceId: chunk.sourceId,
    });
  });

  return { block: parts.join('\n\n---\n\n'), citations };
}

/**
 * The last user message is usually enough, but "what about the pro plan?" only
 * makes sense with the turn before it, so a short tail is folded in.
 */
export function buildQuery(messages: { role: string; content: string }[]): string {
  const recent = messages.filter((m) => m.role === 'user').slice(-2);
  if (recent.length < 2) return recent[recent.length - 1]?.content ?? '';
  const [prev, last] = recent;
  // Short follow-ups lean on the previous question; long ones stand alone.
  return last.content.length < 60 ? `${prev.content}\n${last.content}` : last.content;
}
