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

/**
 * A custom endpoint must not be allowed to bounce the request somewhere else:
 * following a 302 to 169.254.169.254 would hand an attacker the deployment's
 * metadata service, and the URL check the caller ran only covered the first
 * hop. Vendor endpoints never redirect, so this costs nothing.
 */
function redirectMode(a: StreamArgs): RequestRedirect {
  return a.baseUrl.replace(/\/$/, '') === a.provider.baseUrl.replace(/\/$/, '') ? 'follow' : 'error';
}

/**
 * Calls the upstream provider and returns a ReadableStream of plain UTF-8 text
 * deltas. Both adapters normalise to the same output, so the API route and the
 * client never need to know which vendor answered.
 */
export async function streamChat(args: StreamArgs): Promise<ReadableStream<Uint8Array>> {
  return args.provider.api === 'anthropic' ? streamAnthropic(args) : streamOpenAICompatible(args);
}

/**
 * One-shot, non-streaming completion. Used by the bot generator, where the
 * whole reply is parsed as JSON so streaming buys nothing.
 */
export async function completeChat(a: StreamArgs): Promise<string> {
  if (a.provider.api === 'anthropic') {
    if (!a.apiKey) throw new UpstreamError('No Anthropic API key configured.', 401);
    const res = await fetch(`${a.baseUrl.replace(/\/$/, '')}/messages`, {
      method: 'POST',
      signal: a.signal,
      redirect: redirectMode(a),
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': a.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: a.model,
        system: a.system,
        max_tokens: a.maxTokens,
        temperature: a.temperature,
        messages: a.messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      }),
    });
    if (!res.ok) throw new UpstreamError(await describeError(res), res.status);
    const json = await res.json();
    return (json?.content ?? [])
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text)
      .join('');
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (a.apiKey) headers.Authorization = `Bearer ${a.apiKey}`;
  const res = await fetch(`${a.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    signal: a.signal,
    redirect: redirectMode(a),
    body: JSON.stringify({
      model: a.model,
      temperature: a.temperature,
      max_tokens: a.maxTokens,
      messages: [{ role: 'system', content: a.system }, ...a.messages],
    }),
  });
  if (!res.ok) throw new UpstreamError(await describeError(res), res.status);
  const json = await res.json();
  return json?.choices?.[0]?.message?.content ?? '';
}

/* ------------------------------------------------------------------ */
/* OpenAI-compatible                                                    */
/* ------------------------------------------------------------------ */

async function streamOpenAICompatible(a: StreamArgs): Promise<ReadableStream<Uint8Array>> {
  const url = `${a.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (a.apiKey) headers.Authorization = `Bearer ${a.apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    signal: a.signal,
    redirect: redirectMode(a),
    body: JSON.stringify({
      model: a.model,
      stream: true,
      temperature: a.temperature,
      max_tokens: a.maxTokens,
      messages: [{ role: 'system', content: a.system }, ...a.messages],
    }),
  });

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
/* Anthropic Messages API                                               */
/* ------------------------------------------------------------------ */

async function streamAnthropic(a: StreamArgs): Promise<ReadableStream<Uint8Array>> {
  if (!a.apiKey) throw new UpstreamError('No Anthropic API key configured for this chatbot.', 401);

  const res = await fetch(`${a.baseUrl.replace(/\/$/, '')}/messages`, {
    method: 'POST',
    signal: a.signal,
    redirect: redirectMode(a),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': a.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: a.model,
      stream: true,
      system: a.system,
      max_tokens: a.maxTokens,
      temperature: a.temperature,
      messages: a.messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    }),
  });

  if (!res.ok || !res.body) throw new UpstreamError(await describeError(res), res.status);

  return sseToText(res.body, (json) => {
    if (json?.type === 'content_block_delta' && json?.delta?.type === 'text_delta') {
      return json.delta.text ?? '';
    }
    if (json?.type === 'error') throw new UpstreamError(json?.error?.message || 'Upstream error', 502);
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
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const text = pick(JSON.parse(data));
          if (text) controller.enqueue(encoder.encode(text));
        } catch (e) {
          if (e instanceof UpstreamError) {
            controller.error(e);
            return;
          }
          // Ignore keep-alives and partial frames.
        }
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
