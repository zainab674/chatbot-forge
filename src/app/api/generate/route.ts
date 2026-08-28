import { NextRequest, NextResponse } from 'next/server';
import { getProvider } from '@/lib/providers';
import { completeChat, UpstreamError } from '@/lib/llm';
import { consume, clientKey, PER_EXPENSIVE, type Limit } from '@/lib/ratelimit';
import { TALKING_STYLES } from '@/lib/styles';
import { platformGrant, refundCredits, creditsFor } from '@/lib/credits';
import { getPlatformKey } from '@/lib/platform-keys';
import { PLATFORM_MODELS } from '@/lib/platform';
import { sessionUserId } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STYLE_IDS = TALKING_STYLES.filter((s) => s.id !== 'custom').map((s) => s.id);

const GENERATE_MAX_TOKENS = 3_000;
/** Free, account-less generations one network may run per day. */
const ANON_GENERATE_DAILY: Limit = { max: 20, windowSec: 86_400 };

const SYSTEM = `You turn a short description of a chatbot into a configuration for it. Reply with ONLY a JSON object, no prose, no code fences, with these keys:

{
  "name": string,                       // <= 60 chars, the bot's display name
  "tagline": string,                    // <= 120 chars, one line saying what it helps with
  "info": string,                       // the bot's knowledge & rules, plain text with sections and bullet lists; expand everything factual from the description; <= 4000 chars
  "style": string,                      // exactly one of: ${STYLE_IDS.join(', ')}
  "greeting": string,                   // <= 300 chars, the first message visitors see, matching the style
  "placeholder": string,                // <= 80 chars, input placeholder, e.g. "Ask about our plans…"
  "suggestions": string[],              // up to 4 starter questions a visitor would actually click
  "avatarEmoji": string,                // a single emoji that fits the bot
  "qaPairs": [{"q": string, "a": string}]  // up to 8 pairs, ONLY for concrete facts stated in the description (prices, times, policies); empty array if none
}

Rules:
- Write in the same language the description is written in.
- Never invent specific facts (prices, emails, URLs, policies) that are not in the description; keep those parts generic instead.
- The info text is the bot's source of truth: include every concrete fact from the description, organised under headings.`;

export async function POST(req: NextRequest) {
  const fail = (message: string, status: number) => NextResponse.json({ error: message }, { status });

  const client = clientKey(req.headers);
  const limit = await consume(`generate:${client}`, PER_EXPENSIVE);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many generation requests. Give it a moment.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail('Invalid JSON body.', 400);
  }

  const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 4_000) : '';
  if (description.length < 10) return fail('Describe the chatbot in a sentence or two first.', 400);

  const provider = getProvider(typeof body?.provider === 'string' ? body.provider : '');
  if (!provider) return fail('Unknown provider.', 400);
  const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim().slice(0, 200) : '';
  if (!model) return fail('Pick a model first.', 400);

  // Own key runs free; a logged-in account with credits generates on the
  // platform's key (one credit, included models only); and an anonymous
  // builder trying the product gets the same on included models, held to the
  // per-IP rate limit above — this is the top of the signup funnel.
  const ownKey = typeof body?.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : null;
  let apiKey = ownKey;
  let platformUserId: string | null = null;
  let charged = 0;
  const price = creditsFor(SYSTEM.length + description.length, GENERATE_MAX_TOKENS);

  if (!apiKey) {
    const uid = sessionUserId(req);
    if (uid) {
      const platform = await platformGrant(uid, provider.id, model, price);
      if (platform.grant) {
        apiKey = platform.grant.apiKey;
        platformUserId = platform.grant.userId;
        charged = platform.grant.charged;
      }
    } else if (PLATFORM_MODELS.has(model)) {
      // Anonymous generation on the platform's money is the top of the signup
      // funnel, so it stays open — but behind a daily ceiling per network, not
      // just a per-minute one. At ten a minute the old limit allowed thousands
      // of free model calls a day from a single address.
      const daily = await consume(`generate:anon:${client}`, ANON_GENERATE_DAILY);
      if (!daily.ok) {
        return fail(
          'The free limit for building chatbots from a description has been reached for this network today. Create a free account to keep going, or add your own API key.',
          429,
        );
      }
      apiKey = await getPlatformKey(provider.id);
    }
  }
  if (!apiKey) {
    return fail(
      'Enter your API key in the Model section first — or pick a model covered by platform credits (GPT-4o mini, Gemini Flash, Claude Haiku, Llama on Groq). If credits should be covering this, the platform has no key stored for this provider yet.',
      400,
    );
  }

  let raw: string;
  try {
    raw = await completeChat({
      provider,
      baseUrl: provider.baseUrl,
      apiKey,
      model,
      system: SYSTEM,
      messages: [{ role: 'user', content: description }],
      temperature: 0.7,
      maxTokens: GENERATE_MAX_TOKENS,
      signal: req.signal,
    });
  } catch (e: any) {
    // Charged before the call, so nothing was delivered for the credits taken.
    if (platformUserId && charged) await refundCredits(platformUserId, charged, 'generate failed');
    if (e instanceof UpstreamError) return fail(e.message, e.status >= 400 && e.status < 600 ? e.status : 502);
    return fail(e?.message ?? 'Could not reach the model provider.', 502);
  }

  // Models occasionally wrap the JSON in fences or a sentence despite the
  // instructions; take the outermost braces rather than failing on that.
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  let parsed: any;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return fail('The model did not return a usable configuration. Try again, or reword the description.', 502);
  }

  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  const config: Record<string, unknown> = {
    name: str(parsed.name, 60),
    tagline: str(parsed.tagline, 120),
    info: str(parsed.info, 24_000),
    greeting: str(parsed.greeting, 400),
    placeholder: str(parsed.placeholder, 80),
    avatarEmoji: str(parsed.avatarEmoji, 8),
    suggestions: (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
      .map((s: unknown) => str(s, 120))
      .filter(Boolean)
      .slice(0, 4),
    qaPairs: (Array.isArray(parsed.qaPairs) ? parsed.qaPairs : [])
      .map((p: any) => ({ q: str(p?.q, 300), a: str(p?.a, 2_000) }))
      .filter((p: { q: string; a: string }) => p.q && p.a)
      .slice(0, 8),
  };
  if (STYLE_IDS.includes(str(parsed.style, 40))) config.style = str(parsed.style, 40);

  // Drop empty strings so the merge on the client never wipes a field the
  // model chose not to fill.
  for (const k of Object.keys(config)) {
    if (config[k] === '') delete config[k];
  }

  return NextResponse.json({ config });
}
