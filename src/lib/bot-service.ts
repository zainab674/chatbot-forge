import { bots } from './mongodb';
import type { BotDoc, PublicBot } from './types';

/** Shared by the public API route and the server-rendered chat pages. */
export async function getBot(id: string): Promise<BotDoc | null> {
  const col = await bots();
  const doc = await col.findOne({ id }, { projection: { _id: 0 } });
  return (doc as BotDoc) ?? null;
}

export function toPublic(doc: BotDoc): PublicBot {
  return {
    id: doc.id,
    name: doc.name,
    tagline: doc.tagline,
    greeting: doc.greeting,
    placeholder: doc.placeholder,
    suggestions: doc.suggestions ?? [],
    accent: doc.accent,
    theme: doc.theme,
    avatarEmoji: doc.avatarEmoji,
    model: doc.model,
    provider: doc.provider,
    citations: doc.citations ?? true,
    bookingEnabled: doc.bookingEnabled ?? false,
    bookingInstructions: doc.bookingInstructions ?? '',
  };
}

export async function getPublicBot(id: string): Promise<PublicBot | null> {
  const doc = await getBot(id);
  if (!doc || !doc.isPublic) return null;
  return toPublic(doc);
}
