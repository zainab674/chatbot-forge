/**
 * Chunking.
 *
 * Retrieval quality lives or dies here. The rules, in order of preference:
 *   1. Never split mid-sentence if a paragraph break is available.
 *   2. Keep chunks near a target size so embeddings stay comparable.
 *   3. Overlap slightly, so a fact that straddles a boundary is still findable.
 *   4. Carry the nearest markdown heading into each chunk, so a chunk that says
 *      "It costs $12" still knows what "it" is.
 */

export interface Chunk {
  text: string;
  index: number;
}

export interface ChunkOptions {
  /** Target characters per chunk. ~4 chars per token, so 1600 ≈ 400 tokens. */
  size?: number;
  /** Characters repeated from the previous chunk. */
  overlap?: number;
  /** Chunks shorter than this are merged into their neighbour. */
  minSize?: number;
}

const DEFAULTS = { size: 1600, overlap: 200, minSize: 120 };

/** Breadcrumbs longer than this stop being a hint and start being the chunk. */
const MAX_HEADING = 120;

export function chunkText(input: string, opts: ChunkOptions = {}): Chunk[] {
  const size = Math.max(64, opts.size ?? DEFAULTS.size);
  // An overlap at or above the target would make the stride collapse and
  // explode the chunk count, so it is capped at half the chunk.
  const overlap = Math.max(0, Math.min(opts.overlap ?? DEFAULTS.overlap, Math.floor(size / 2)));
  const minSize = opts.minSize ?? DEFAULTS.minSize;

  const text = normalise(input);
  if (!text) return [];
  if (text.length <= size) return [{ text, index: 0 }];

  const blocks = splitBlocks(text);
  const out: string[] = [];
  let current = '';
  /** Most recent heading seen anywhere in the document. */
  let heading = '';
  /**
   * The heading in effect when the current chunk started. Using the live
   * `heading` instead would stamp a chunk with the last section it happened to
   * touch, which is usually a section whose body is in the *next* chunk.
   */
  let chunkHeading = '';
  let hasContent = false;

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) out.push(withHeading(trimmed, chunkHeading));
    current = '';
    hasContent = false;
  };

  /** Room left in this chunk, allowing for the breadcrumb flush() may prepend. */
  const budget = () => size - breadcrumbCost(chunkHeading || heading);

  for (const block of blocks) {
    const isHeading =
      /^#{1,6}\s+\S/.test(block) ||
      (block.length < 80 && /^[A-Z0-9][^.!?]*$/.test(block) && !block.endsWith(','));

    if (isHeading) {
      // A heading becomes the breadcrumb for what follows. It only starts a new
      // chunk when the current one is close to full: flushing on every heading
      // shreds a heading-dense document into runts, which retrieves badly and
      // burns through the per-source chunk cap.
      if (current.length + block.length + 2 > budget()) {
        flush();
        if (overlap > 0 && out.length) current = tail(out[out.length - 1], overlap);
      }
      heading = block.replace(/^#{1,6}\s+/, '').trim();
      if (!hasContent) chunkHeading = heading;
      current += (current ? '\n\n' : '') + block;
      hasContent = true;
      continue;
    }

    if (block.length > size) {
      // A single huge paragraph: fall back to sentence boundaries.
      flush();
      chunkHeading = heading;
      for (const piece of splitLong(block, size - breadcrumbCost(heading), overlap)) {
        out.push(withHeading(piece, heading));
      }
      continue;
    }

    if (current.length + block.length + 2 > budget()) {
      flush();
      if (overlap > 0 && out.length) current = tail(out[out.length - 1], overlap);
    }
    if (!hasContent) chunkHeading = heading;
    current += (current ? '\n\n' : '') + block;
    hasContent = true;
  }
  flush();

  // Merge a runt final chunk back into its predecessor.
  if (out.length > 1 && out[out.length - 1].length < minSize) {
    const last = out.pop()!;
    out[out.length - 1] += `\n\n${last}`;
  }

  return out.map((text, index) => ({ text, index }));
}

function normalise(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitBlocks(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .flatMap((para) => (para.length > 4000 ? para.split(/\n/) : [para]))
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitLong(block: string, size: number, overlap: number): string[] {
  // Sentence enders include the CJK forms, otherwise Chinese and Japanese prose
  // never splits and falls through to the hard character cut below.
  const sentences = block.match(/[^.!?。！？\n]+[.!?。！？]*\s*/g) ?? [block];
  const out: string[] = [];
  // Never let the stride reach zero, which would loop forever.
  const step = Math.max(1, size - Math.min(overlap, size - 1));

  let cur = '';
  // True while `cur` holds nothing but text already emitted in the previous
  // chunk. Emitting that on its own would duplicate content verbatim.
  let onlyOverlap = false;

  for (const s of sentences) {
    if (cur.length + s.length > size && cur) {
      out.push(cur.trim());
      cur = overlap > 0 ? tail(cur, overlap) : '';
      onlyOverlap = cur.length > 0;
    }

    // A single sentence longer than the target still has to be cut somewhere.
    if (s.length > size) {
      if (cur.trim() && !onlyOverlap) out.push(cur.trim());
      cur = '';
      onlyOverlap = false;
      for (let i = 0; i < s.length; i += step) out.push(s.slice(i, i + size).trim());
      continue;
    }

    cur += s;
    onlyOverlap = false;
  }

  if (cur.trim() && !onlyOverlap) out.push(cur.trim());
  return out.filter(Boolean);
}

/** Last `n` characters, snapped forward to a word boundary. */
function tail(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(s.length - n);
  const space = cut.indexOf(' ');
  return space > 0 ? cut.slice(space + 1) : cut;
}

/** Characters `withHeading` would add, so the size check can allow for them. */
function breadcrumbCost(heading: string): number {
  return heading ? Math.min(heading.length, MAX_HEADING) + 1 : 0;
}

function withHeading(text: string, heading: string): string {
  if (!heading) return text;
  const label = heading.length > MAX_HEADING ? `${heading.slice(0, MAX_HEADING - 1).trimEnd()}…` : heading;
  if (text.toLowerCase().startsWith(label.toLowerCase())) return text;
  if (text.slice(0, 200).includes(label)) return text;
  return `${label}\n${text}`;
}

/** Q&A pairs are their own chunk each: the question is the best retrieval key. */
export function chunkQA(pairs: { q: string; a: string }[]): Chunk[] {
  return pairs
    .filter((p) => p.q.trim() && p.a.trim())
    .map((p, index) => ({ text: `Q: ${p.q.trim()}\nA: ${p.a.trim()}`, index }));
}
