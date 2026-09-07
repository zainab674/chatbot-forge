import { NextRequest, NextResponse } from 'next/server';
import { bots } from '@/lib/mongodb';
import { decrypt } from '@/lib/crypto';
import { getProvider, resolveBaseUrl } from '@/lib/providers';
import {
  platformGrant,
  refundCredits,
  denialMessage,
  trialGrant,
  creditsFor,
  fitToPlatformBudget,
} from '@/lib/credits';
import { isAnonOwner } from '@/lib/auth';
import { buildSystemPrompt } from '@/lib/prompt';
import { streamChat, UpstreamError } from '@/lib/llm';
import { originAllowed, effectiveOrigin } from '@/lib/validate';
import { assertReachableEndpoint } from '@/lib/net-guard';
import { rateLimit, clientKey } from '@/lib/ratelimit';
import { retrieve, buildContext, buildQuery } from '@/lib/knowledge/retrieve';
import { recordExchange, validConversationId } from '@/lib/transcripts';
import { sources as sourcesCollection } from '@/lib/mongodb';
import type { BotDoc, ChatMessage, Citation } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Embed-Origin, X-Conversation-Id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // Citations ride along in a header so the body stays plain streamed text.
  'Access-Control-Expose-Headers': 'X-Citations, X-Retrieval',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * POST /api/chat/:id
 * Body: { messages: [{role, content}, ...] }
 * Returns: text/plain stream of the reply as it is generated.
 *
 * The creator's API key never leaves the server — the browser only ever talks
 * to this route.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const fail = (message: string, status: number) =>
    NextResponse.json({ error: message }, { status, headers: CORS });

  let doc: BotDoc | null = null;
  try {
    const col = await bots();
    doc = (await col.findOne({ id: params.id }, { projection: { _id: 0 } })) as BotDoc | null;
  } catch (e) {
    console.error('[chatbot-forge] chat lookup failed:', e);
    return fail('Something went wrong on the server.', 500);
  }

  if (!doc) return fail('Chatbot not found.', 404);
  if (!doc.isPublic) return fail('This chatbot is paused by its owner.', 403);

  const selfHost = req.headers.get('host');
  const origin = effectiveOrigin(
    req.headers.get('origin'),
    req.headers.get('x-embed-origin'),
    selfHost,
  );
  if (!originAllowed(doc.allowedOrigins ?? [], origin, selfHost)) {
    return fail('This chatbot is not allowed to run on this domain.', 403);
  }

  const client = clientKey(req.headers);
  const limit = await rateLimit(doc.id, client);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error:
          limit.scope === 'bot'
            ? 'This chatbot is handling too many messages right now. Try again shortly.'
            : 'You are sending messages too quickly. Give it a moment.',
      },
      { status: 429, headers: { ...CORS, 'Retry-After': String(limit.retryAfter) } },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail('Invalid JSON body.', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail('Expected a JSON object with a "messages" array.', 400);
  }

  const incoming: ChatMessage[] = Array.isArray(body.messages) ? body.messages : [];
  const history = incoming
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 12_000) }))
    .filter((m) => m.content.trim().length > 0);

  if (!history.length) return fail('No message to answer.', 400);
  if (history[history.length - 1].role !== 'user') return fail('Last message must be from the user.', 400);

  // Keep only the most recent N turns so long chats do not grow unbounded.
  const keep = Math.max(2, (doc.memoryTurns ?? 12) * 2);
  const trimmed = history.slice(-keep);

  const provider = getProvider(doc.provider);
  if (!provider) return fail(`This chatbot points at an unknown provider "${doc.provider}".`, 500);

  let creatorKey: string | null = null;
  if (doc.apiKeyEnc) {
    try {
      creatorKey = decrypt(doc.apiKeyEnc);
    } catch {
      return fail('The stored API key could not be decrypted. Re-save the key on this chatbot.', 500);
    }
  }
  // The creator's own key runs free. With no key saved, the bot may run on the
  // platform's keys instead (set by an admin in /admin) — for accounts with credits (one message = one
  // credit), or for anonymous drafts on a small free trial, both included
  // models only. Anonymous drafts can never have a stored key, so the trial is
  // their only path here.
  let apiKey: string | null = creatorKey;
  let platformUserId: string | null = null;
  let charged = 0;

  // What actually gets sent. On the platform's money both the conversation and
  // the output cap are trimmed to a bounded size, so the cost of one message
  // cannot run away — and so the price is about what was sent rather than about
  // what was asked for.
  //
  // Priced against the prompt without retrieved context, because the key needed
  // to embed the query has not been granted yet. The final payload is re-fitted
  // below once the context is known, so the ceiling still holds; only the price
  // can end up slightly under, which is the right way round to be wrong.
  let outgoing = trimmed;
  let outputCap = doc.maxTokens;

  if (!apiKey) {
    const budgeted = fitToPlatformBudget(trimmed, buildSystemPrompt(doc), doc.maxTokens);
    const price = creditsFor(budgeted.promptChars, budgeted.maxTokens);

    if (isAnonOwner(doc.ownerId)) {
      const trial = await trialGrant(doc, client);
      if (trial.apiKey) {
        apiKey = trial.apiKey;
      } else if (!provider.keyOptional) {
        return fail(denialMessage(trial.reason), 400);
      }
    } else {
      const platform = await platformGrant(doc.ownerId, doc.provider, doc.model, price);
      if (platform.grant) {
        apiKey = platform.grant.apiKey;
        platformUserId = platform.grant.userId;
        // Already deducted — the balance moved before the model was called, so
        // a burst of concurrent messages cannot all spend the same credit.
        charged = platform.grant.charged;
      } else if (!provider.keyOptional) {
        return fail(denialMessage(platform.reason), 400);
      }
    }

    // Only if a platform key was actually granted. A keyless self-hosted
    // endpoint reaches this branch too — it costs the platform nothing, so
    // trimming its prompts would be a limit imposed for no reason.
    if (apiKey) {
      outgoing = budgeted.messages;
      outputCap = budgeted.maxTokens;
    }
  }

  /** Hands the credits back when the answer never happened. */
  const refund = async (why: string) => {
    if (platformUserId && charged) await refundCredits(platformUserId, charged, why);
  };

  // A custom endpoint is only honoured for the creator's own key — see
  // resolveBaseUrl. `platformUserId` is not the test: the anonymous trial also
  // runs on a platform key and sets nothing.
  const onPlatformKey = Boolean(apiKey) && apiKey !== creatorKey;
  const baseUrl = resolveBaseUrl(provider, doc.customBaseUrl, { platformKey: onPlatformKey });
  if (!baseUrl) {
    await refund('no endpoint');
    return fail(
      doc.customBaseUrl
        ? 'A custom endpoint needs this chatbot to have its own API key saved. Platform credits only run on the built-in providers.'
        : 'This chatbot has no endpoint configured.',
      400,
    );
  }
  if (baseUrl !== provider.baseUrl) {
    // Creator-supplied destination: same SSRF checks the crawler applies, so a
    // bot cannot be used to read the deployment's internal network.
    try {
      await assertReachableEndpoint(baseUrl);
    } catch (e) {
      await refund('endpoint rejected');
      return fail(`This chatbot's custom endpoint was rejected: ${(e as Error).message}`, 400);
    }
  }

  // ---- knowledge base ----
  let citations: Citation[] = [];
  let contextBlock = '';
  let contextCount = 0;
  let hasSources = false;

  try {
    const sourcesCol = await sourcesCollection();
    // Whether there is one, not how many. This runs on every single message, and
    // counting every source to answer a yes/no question is work nobody reads.
    hasSources = Boolean(
      await sourcesCol.findOne({ botId: doc.id, status: 'ready' }, { projection: { _id: 0, id: 1 } }),
    );
  } catch {
    hasSources = false;
  }

  if (hasSources) {
    try {
      let embeddingKey: string | null = null;
      if (doc.embeddingKeyEnc) {
        try {
          embeddingKey = decrypt(doc.embeddingKeyEnc);
        } catch {
          embeddingKey = null;
        }
      }
      // Falls back to the chat key when the embedding provider is the same
      // vendor — but never lends out a platform key, which would put it on a
      // creator-chosen embedding endpoint and undo the check above.
      if (!embeddingKey && !onPlatformKey) embeddingKey = apiKey;

      const results = await retrieve({
        bot: doc,
        query: buildQuery(trimmed),
        embeddingKey,
        signal: req.signal,
      });
      const context = buildContext(results);
      contextBlock = context.block;
      contextCount = context.citations.length;
      citations = doc.citations ? context.citations : [];
    } catch (e) {
      // A retrieval failure should not take the whole conversation down.
      console.warn('[chatbot-forge] retrieval failed:', (e as Error).message);
    }
  }

  const promptContext = hasSources
    ? { block: contextBlock, count: contextCount, searchedButEmpty: contextCount === 0 }
    : undefined;
  let system = buildSystemPrompt(doc, promptContext);

  // Retrieved context can be large, so the ceiling is applied once more against
  // the prompt that is actually going upstream — this is the pass that decides
  // what is sent, and it trims the system prompt as well as the conversation.
  if (onPlatformKey) {
    const fitted = fitToPlatformBudget(outgoing, system, outputCap);
    outgoing = fitted.messages;
    system = fitted.system;
  }

  try {
    const stream = await streamChat({
      provider,
      baseUrl,
      apiKey,
      model: doc.model,
      system,
      messages: outgoing,
      temperature: doc.temperature,
      maxTokens: outputCap,
      signal: req.signal,
    });

    // Fire-and-forget usage counter.
    bots()
      .then((col) => col.updateOne({ id: doc!.id }, { $inc: { messageCount: 1 } }))
      .catch(() => {});

    // Transcript logging, when the owner has asked for it. The reply is only
    // known once it has finished streaming, so the stream is tapped on its way
    // to the visitor rather than buffered — buffering would undo streaming,
    // which is the entire point of this route.
    const conversationId = req.headers.get('x-conversation-id') ?? '';
    const delivered = doc.logConversations && validConversationId(conversationId)
      ? tapStream(stream, (answer) => {
          recordExchange({
            bot: doc!,
            conversationId,
            history: outgoing,
            answer,
            visitorKey: client,
          }).catch((e) => console.warn('[chatbot-forge] transcript write failed:', e?.message));
        })
      : stream;

    const headers: Record<string, string> = {
      ...CORS,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    };
    if (hasSources) headers['X-Retrieval'] = `${contextCount}`;
    if (citations.length) {
      // base64 so non-ASCII titles survive the header, which must stay latin-1.
      headers['X-Citations'] = Buffer.from(JSON.stringify(citations), 'utf8').toString('base64');
    }

    return new NextResponse(delivered, { headers });
  } catch (e: any) {
    // The upstream call never produced an answer, so nothing was delivered for
    // the credits taken above.
    await refund('upstream error');

    // A provider's error body is useful when it is the creator's own key that
    // was rejected — it names the problem. On a platform key it is somebody
    // else's diagnostic, sent to a stranger: OpenAI's 401 quotes the key it
    // rejected in masked form, which handed an anonymous visitor the first and
    // last characters of the platform's key and confirmation that one exists.
    if (onPlatformKey) {
      console.error('[chatbot-forge] platform-key upstream failure:', doc.provider, doc.model, e?.message);
      return fail(
        'This chatbot could not reach the model just now. Its owner may need to check their credits, or add their own API key.',
        502,
      );
    }

    if (e instanceof UpstreamError) return fail(e.message, e.status >= 400 && e.status < 600 ? e.status : 502);
    return fail(e?.message ?? 'Could not reach the model provider.', 502);
  }
}

/**
 * Passes a stream through unchanged while collecting a copy of the text.
 *
 * `onDone` runs when the stream closes normally. A visitor who navigates away
 * mid-answer cancels it, and a half-answer is not worth storing — so a
 * cancelled stream records nothing.
 */
function tapStream(
  source: ReadableStream<Uint8Array>,
  onDone: (text: string) => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const reader = source.getReader();
  let collected = '';

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          // Flush the decoder: a final character split across two chunks is
          // otherwise dropped from the transcript that gets stored.
          collected += decoder.decode();
          controller.close();
          if (collected) onDone(collected);
          return;
        }
        collected += decoder.decode(value, { stream: true });
        controller.enqueue(value);
      } catch (e) {
        controller.error(e);
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {});
    },
  });
}
