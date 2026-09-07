import { endpointFetch } from './net-guard';
import type { ChatMessage } from './types';
import type { Provider } from './providers';

export interface StreamArgs {
  provider: Provider;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  system: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
}

/** True when this is the vendor's own documented endpoint, not a creator's. */
function isVendorEndpoint(a: StreamArgs): boolean {
  return a.baseUrl.replace(/\/$/, '') === a.provider.baseUrl.replace(/\/$/, '');
}

/**
 * POSTs to the endpoint, by the route appropriate to who chose it.
 *
 * A vendor endpoint is a constant in this repo, so it gets the platform's
 * ordinary fetch. A creator's custom endpoint is a URL from a bot document and
 * gets `endpointFetch`, which connects only to the address the SSRF check
 * cleared — otherwise the hostname is resolved once for the check and again for
 * the connection, and only the second one decides where the request goes.
 *
 * Redirects on that path are refused rather than followed: a 302 to
 * 169.254.169.254 would hand over the deployment's metadata service, and the
 * check the caller ran only ever covered the first hop.
 */
async function post(a: StreamArgs, url: string, body: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (a.apiKey) headers.Authorization = `Bearer ${a.apiKey}`;

  if (isVendorEndpoint(a)) {
    return fetch(url, { method: 'POST', headers, signal: a.signal, redirect: 'follow', body });
  }

  const res = await endpointFetch(url, { method: 'POST', headers, signal: a.signal, body });
  if (res.status >= 300 && res.status < 400) {
    res.body?.cancel().catch(() => {});
    throw new UpstreamError('That custom endpoint redirected the request, which is not allowed.', 502);
  }
  return res;
}

/**
 * Calls the upstream provider and returns a ReadableStream of plain UTF-8 text
 * deltas, so the API route and the client never need to know which vendor
 * answered.
 */
export async function streamChat(args: StreamArgs): Promise<ReadableStream<Uint8Array>> {
  return streamOpenAICompatible(args);
}

/**
 * One-shot, non-streaming completion. Used by the bot generator, where the
 * whole reply is parsed as JSON so streaming buys nothing.
 */
export async function completeChat(a: StreamArgs): Promise<string> {
  const res = await post(
    a,
    `${a.baseUrl.replace(/\/$/, '')}/chat/completions`,
    JSON.stringify({
      model: a.model,
      temperature: a.temperature,
      max_tokens: a.maxTokens,
      messages: [{ role: 'system', content: a.system }, ...a.messages],
    }),
  );
  if (!res.ok) throw new UpstreamError(await describeError(res), res.status);
  const json = await res.json();
  return json?.choices?.[0]?.message?.content ?? '';
}

/* ------------------------------------------------------------------ */
/* OpenAI-compatible                                                    */
/* ------------------------------------------------------------------ */

async function streamOpenAICompatible(a: StreamArgs): Promise<ReadableStream<Uint8Array>> {
  const res = await post(
    a,
    `${a.baseUrl.replace(/\/$/, '')}/chat/completions`,
    JSON.stringify({
      model: a.model,
      stream: true,
      temperature: a.temperature,
      max_tokens: a.maxTokens,
      messages: [{ role: 'system', content: a.system }, ...a.messages],
    }),
  );

  if (!res.ok || !res.body) throw new UpstreamError(await describeError(res), res.status);

  return sseToText(res.body, (json) => {
    const delta = json?.choices?.[0]?.delta;
    // Some vendors put the text in `content`, reasoning models may also emit
    // `reasoning_content` — we only surface the visible answer.
    if (typeof delta?.content === 'string') return delta.content;
    return '';
  });
}

/* ------------------------------------------------------------------ */
/* Shared SSE plumbing                                                  */
/* ------------------------------------------------------------------ */

function sseToText(
  body: ReadableStream<Uint8Array>,
  pick: (json: any) => string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = body.getReader();
  let buffer = '';

  return new ReadableStream<Uint8Array>({
    /**
     * Reads until there is something to hand on, or the upstream body ends.
     *
     * The loop is the whole point. A `pull` that consumes a chunk and enqueues
     * nothing is never called again — the stream has no queued data and no
     * pending pull, so nothing wakes it and the reply hangs forever with the
     * answer already sitting in the socket. Frames carrying no visible text are
     * routine: the role-only opening frame, keep-alives, and, on a reasoning
     * model, every frame of the thinking phase before the answer starts.
     */
    async pull(controller) {
      for (;;) {
        let done: boolean;
        let value: Uint8Array | undefined;
        try {
          ({ done, value } = await reader.read());
        } catch (e) {
          controller.error(e);
          return;
        }
        if (done) {
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let enqueued = false;
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const text = pick(JSON.parse(data));
            if (text) {
              controller.enqueue(encoder.encode(text));
              enqueued = true;
            }
          } catch (e) {
            if (e instanceof UpstreamError) {
              controller.error(e);
              return;
            }
            // Ignore keep-alives and partial frames.
          }
        }
        if (enqueued) return;
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {});
    },
  });
}

export class UpstreamError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

async function describeError(res: Response): Promise<string> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      detail = json?.error?.message || json?.message || json?.error || text;
    } catch {
      detail = text;
    }
  } catch {
    /* ignore */
  }
  detail = String(detail).slice(0, 400);

  if (res.status === 401 || res.status === 403) {
    return `The provider rejected the API key (${res.status}). Check the key saved on this chatbot. ${detail}`;
  }
  if (res.status === 404) {
    return `The provider could not find that model (404). Check the model name. ${detail}`;
  }
  if (res.status === 429) {
    return `Rate limited or out of credit on the provider account (429). ${detail}`;
  }
  return `Provider error ${res.status}. ${detail}`;
}
