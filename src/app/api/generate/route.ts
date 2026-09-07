import { NextRequest, NextResponse } from 'next/server';
import { getProvider } from '@/lib/providers';
import { completeChat, UpstreamError } from '@/lib/llm';
import { consume, clientKey, PER_EXPENSIVE, type Limit } from '@/lib/ratelimit';
import { TALKING_STYLES } from '@/lib/styles';
import { platformGrant, refundCredits, creditsFor, type DenyReason } from '@/lib/credits';
import { getPlatformKey } from '@/lib/platform-keys';
import { PLATFORM_MODELS } from '@/lib/platform';
import { sessionOf, sessionRevoked } from '@/lib/auth';
import { users } from '@/lib/mongodb';

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

/**
 * Why the platform key was not handed over, said to the person building the
 * bot rather than to a visitor of a finished one — so it names the thing they
 * can actually act on. The catalogue in lib/credits addresses the visitor,
 * which is the wrong audience here, and this route used to ignore the reason
 * altogether: an account simply out of credits was told the platform had no
 * key stored, which sent people to /admin to re-enter a key that was already
 * there.
 */
function keyDenial(reason: DenyReason | undefined, model: string): string {
  switch (reason) {
    case 'no-credits':
      return 'Your account is out of platform credits, so this cannot run on the platform key. Top up your credits, or paste your own API key in the Model section.';
    case 'model-not-included':
      return `${model} is not covered by platform credits. Pick GPT-OSS on Groq, Gemini Flash or GPT-4o mini, or paste your own API key in the Model section.`;
    case 'no-platform-key':
      return 'The platform has no key stored for this provider yet. Paste your own API key in the Model section, or pick a provider the platform has a key for.';
    default:
      return 'Enter your API key in the Model section first — or pick a model covered by platform credits (GPT-OSS on Groq, Gemini Flash, GPT-4o mini).';
  }
}

/**
 * The account this request may spend credits from, or null.
 *
 * A signed cookie alone is not enough on a path that moves money. The token is
 * self-contained, so "sign out everywhere" and a password reset can only take
 * effect by checking the account's `sessionsValidFrom` on the way in — and a
 * deletion in flight has already marked the row. Every other authenticated
 * route in the app does this; this one used to take the id straight off the
 * cookie, which left a stolen session able to spend the balance it was
 * supposedly signed out of.
 */
async function spendingAccountId(req: NextRequest): Promise<string | null> {
  const session = sessionOf(req);
  if (!session) return null;
  const user = await (await users()).findOne({ id: session.userId });
  if (!user || user.deletedAt || sessionRevoked(session, user)) return null;
  return user.id;
}

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

  let denied: DenyReason | undefined;

  if (!apiKey) {
    const uid = await spendingAccountId(req);
    if (uid) {
      const platform = await platformGrant(uid, provider.id, model, price);
      if (platform.grant) {
        apiKey = platform.grant.apiKey;
        platformUserId = platform.grant.userId;
        charged = platform.grant.charged;
      } else {
        denied = platform.reason;
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
      if (!apiKey) denied = 'no-platform-key';
    } else {
      denied = 'model-not-included';
    }
  }
  if (!apiKey) {
    console.warn('[chatbot-forge] generate denied:', denied ?? 'no-key', provider.id, model);
    return fail(keyDenial(denied, model), 400);
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

    // Same rule as the chat route: a provider's error text describes the key it
    // rejected, and on the platform's key that is not the caller's to read.
    if (!ownKey) {
      console.error('[chatbot-forge] platform-key generate failure:', provider.id, model, e?.message);
      return fail('Could not reach the model just now. Try again, or add your own API key.', 502);
    }

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
