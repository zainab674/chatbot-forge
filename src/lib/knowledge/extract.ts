/**
 * File to text.
 *
 * PDF and DOCX go through real parsers; everything else is handled here so a
 * plain .txt or .csv upload costs nothing.
 */
import { htmlToText, extractTitle } from './html';
import { SUPPORTED_EXTENSIONS } from './constants';

export interface Extracted {
  text: string;
  title: string;
  pages: number;
}

export { SUPPORTED_EXTENSIONS, MAX_FILE_BYTES } from './constants';

export async function extractFile(name: string, buffer: Buffer): Promise<Extracted> {
  const ext = (name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
  const base = name.replace(/\.[^.]+$/, '');

  switch (ext) {
    case '.pdf':
      return extractPdf(base, buffer);
    case '.docx':
      return extractDocx(base, buffer);
    case '.csv':
      return { text: tabularToText(buffer.toString('utf8'), ','), title: base, pages: 1 };
    case '.tsv':
      return { text: tabularToText(buffer.toString('utf8'), '\t'), title: base, pages: 1 };
    case '.json':
      return { text: jsonToText(buffer.toString('utf8')), title: base, pages: 1 };
    case '.html':
    case '.htm': {
      const html = buffer.toString('utf8');
      return { text: htmlToText(html), title: extractTitle(html) || base, pages: 1 };
    }
    case '.txt':
    case '.md':
    case '.markdown':
      return { text: buffer.toString('utf8'), title: base, pages: 1 };
    default:
      throw new Error(
        `Unsupported file type "${ext || name}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}.`,
      );
  }
}

async function extractPdf(title: string, buffer: Buffer): Promise<Extracted> {
  // Imported lazily: the PDF stack is large and most sources are not PDFs.
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const pages = result.pages ?? [];
    // Page markers give citations something to point at inside a long document.
    const text = pages.length
      ? pages.map((p: any, i: number) => `[Page ${i + 1}]\n${(p.text ?? '').trim()}`).join('\n\n')
      : result.text ?? '';
    if (!text.replace(/\[Page \d+\]/g, '').trim()) {
      throw new Error('No text found. This PDF is probably scanned images, which needs OCR.');
    }
    return { text, title, pages: result.total ?? pages.length ?? 1 };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractDocx(title: string, buffer: Buffer): Promise<Extracted> {
  const mammoth = await import('mammoth');
  const { value } = await mammoth.extractRawText({ buffer });
  if (!value.trim()) throw new Error('That .docx appears to be empty.');
  return { text: value, title, pages: 1 };
}

/**
 * Rows become "Column: value" lines. A raw CSV dump embeds badly because the
 * header row is far away from the data; repeating the header per row fixes it.
 */
export function tabularToText(raw: string, delimiter: string): string {
  const rows = parseDelimited(raw, delimiter);
  if (!rows.length) return '';
  const [header, ...body] = rows;
  if (!body.length) return header.join(' ');

  return body
    .map((row) =>
      header
        .map((col, i) => (row[i] ? `${col.trim()}: ${row[i].trim()}` : ''))
        .filter(Boolean)
        .join('\n'),
    )
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Handles quoted fields, escaped quotes, and newlines inside quotes.
 *
 * Lenient about stray quotes on purpose: real exports contain values like
 * `5" steel pipe`. Treating that as the start of a quoted field would swallow
 * every following row until the next quote, silently losing data, so a quote is
 * only special at the start of a field, and a closing quote must be followed by
 * a delimiter, a newline or end of input.
 */
export function parseDelimited(raw: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) {
      if (c === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          const next = raw[i + 1];
          if (next === undefined || next === delimiter || next === '\n' || next === '\r') {
            quoted = false;
          } else {
            // A lone quote mid-value: keep it as text.
            field += '"';
          }
        }
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim()));
}

/** Flattens JSON into "path: value" lines, which embed far better than braces. */
export function jsonToText(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  const lines: string[] = [];
  const walk = (value: any, path: string) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, path ? `${path}[${i}]` : `[${i}]`));
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
    } else {
      lines.push(`${path}: ${String(value)}`);
    }
  };
  walk(parsed, '');
  return lines.join('\n');
}
