/**
 * Shared between the browser and the server, so the upload picker and the
 * server-side validator can never disagree about what is accepted.
 * Kept free of Node-only imports on purpose.
 */
export const SUPPORTED_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.html',
  '.htm',
];

/**
 * Upload ceiling, in megabytes.
 *
 * Serverless hosts cap the request body well below what a self-hosted Node
 * server will take: Netlify buffers at 6MB and base64-encodes binary uploads on
 * the way in, which leaves roughly 4MB of real file. Going over that is
 * rejected by the platform before the app sees it, so the limit is
 * configurable and the uploader shows whatever is actually allowed.
 */
export const MAX_UPLOAD_MB = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 100) : 20;
})();

export const MAX_FILE_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
