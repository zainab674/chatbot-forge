import { conversations } from './mongodb';
import type { BotDoc, ChatMessage, ConversationDoc } from './types';

/**
 * Stored transcripts.
 *
 * The feature customers ask for first — "what is my bot actually saying?" —
 * and the one with the sharpest edges, because a transcript is a log of what
 * strangers typed. So: off unless the owner turns it on, per-bot retention
 * enforced by a TTL index rather than by remembering to clean up, and the
 * whole lot deleted with the bot.
 *
 * The client sends a conversation id per chat session, which is what turns a
 * stream of independent requests back into one readable thread. It is
 * untrusted, so it is length-checked and scoped to the bot on write: the worst
 * a forged one can do is append to another visitor's thread on the same bot,
 * which is why it is random and long.
 */

/** Caps one stored thread, so a long-running widget cannot grow without bound. */
const MAX_STORED_MESSAGES = 200;
const MAX_STORED_CHARS = 8_000;

export function validConversationId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(id);
}

export interface RecordArgs {
  bot: Pick<BotDoc, 'id' | 'ownerId' | 'logConversations' | 'logRetentionDays'>;
  conversationId: string;
  /** The turns sent to the model, oldest first. */
  history: ChatMessage[];
  /** What the bot answered, once the stream finished. */
  answer: string;
  visitorKey: string;
}

/**
 * Writes one exchange onto its conversation.
 *
 * Replaces the stored message list rather than appending to it: the client
 * sends the whole history on every request anyway, so a replace keeps the
 * transcript consistent with what the model actually saw, and a dropped
 * request cannot leave a thread with a question and no answer.
 */
export async function recordExchange(a: RecordArgs): Promise<void> {
  if (!a.bot.logConversations) return;
  if (!validConversationId(a.conversationId)) return;
  if (!a.answer.trim()) return;

  const messages: ChatMessage[] = [...a.history, { role: 'assistant' as const, content: a.answer }]
    .slice(-MAX_STORED_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_STORED_CHARS) }));

  const now = new Date().toISOString();
  const retentionDays = Math.min(365, Math.max(1, a.bot.logRetentionDays || 30));

  const col = await conversations();
  await col.updateOne(
    { id: a.conversationId, botId: a.bot.id },
    {
      $set: {
        messages,
        messageCount: messages.length,
        updatedAt: now,
        // Retention runs from the last message, so an active conversation is
        // not deleted out from under someone reading it.
        expiresAt: new Date(Date.now() + retentionDays * 86_400_000),
        ownerId: a.bot.ownerId,
        visitorKey: a.visitorKey.slice(0, 64),
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
}

/** Deletes every transcript for a bot. Used when the bot goes, or logging is switched off. */
export async function deleteTranscripts(botId: string): Promise<number> {
  const col = await conversations();
  const res = await col.deleteMany({ botId });
  return res.deletedCount ?? 0;
}

export interface TranscriptSummary {
  id: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  /** First thing the visitor said, for the list view. */
  opening: string;
}

export async function listTranscripts(botId: string, limit = 50): Promise<TranscriptSummary[]> {
  const col = await conversations();
  const rows = await col
    .find({ botId }, { projection: { _id: 0 } })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();

  return rows.map((r: ConversationDoc) => ({
    id: r.id,
    messageCount: r.messageCount ?? r.messages?.length ?? 0,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    opening: (r.messages ?? []).find((m) => m.role === 'user')?.content.slice(0, 140) ?? '',
  }));
}

export async function getTranscript(botId: string, id: string): Promise<ConversationDoc | null> {
  const col = await conversations();
  return (await col.findOne({ botId, id }, { projection: { _id: 0 } })) as ConversationDoc | null;
}
