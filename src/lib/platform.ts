/**
 * Platform-tier constants, in their own module so client components can import
 * them without dragging in the MongoDB-backed credit logic (lib/credits.ts).
 */

/** The cheap models a bot may run on the platform's own API keys. */
export const PLATFORM_MODELS = new Set([
  'gpt-4o-mini',
  'gpt-4.1-mini',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
]);

/**
 * Messages an anonymous draft may send on the platform keys before its creator
 * has to sign up. Small on purpose: enough to see the bot talk, useless for
 * running a real widget.
 */
export const ANON_TRIAL_MESSAGES = 10;

/**
 * Credits a new account starts with.
 *
 * One credit is roughly one message or one generation on an included model
 * (see creditsFor), so this is a handful of real conversations: enough to
 * build a bot, talk to it and decide, before anyone is asked for a card.
 */
export const SIGNUP_CREDITS = 25;

/**
 * Longest note a creator may attach when asking the admin for a key.
 *
 * Here rather than in lib/key-requests.ts for the same reason as everything
 * else in this file: the builder counts characters in the browser, and that
 * component must not drag the MongoDB-backed request logic in with it.
 */
export const KEY_REQUEST_MAX_CHARS = 600;
