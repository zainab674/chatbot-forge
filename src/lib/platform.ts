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
  'claude-haiku-4-5',
  'claude-3-5-haiku-latest',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
]);

/**
 * Messages an anonymous draft may send on the platform keys before its creator
 * has to sign up. Small on purpose: enough to see the bot talk, useless for
 * running a real widget.
 */
export const ANON_TRIAL_MESSAGES = 10;
