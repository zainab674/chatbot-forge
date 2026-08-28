import type { ChatThemeId } from './themes';
export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

/** A question the creator answered ahead of time. Simple mode of the knowledge base. */
export interface QAPair {
  q: string;
  a: string;
}

/** What the creator configures. */
export interface BotConfig {
  name: string;
  tagline: string;
  /** Free-text knowledge / persona / rules — "info" in the builder. */
  info: string;
  /** Always in the prompt, no retrieval involved. Good for a handful of FAQs. */
  qaPairs: QAPair[];
  /** Preset id from TALKING_STYLES, or 'custom'. */
  style: string;
  /** Used when style === 'custom'. */
  customStyle: string;
  provider: string;
  model: string;
  /** Only for provider === 'custom'. */
  customBaseUrl: string;
  temperature: number;
  maxTokens: number;
  greeting: string;
  placeholder: string;
  suggestions: string[];
  accent: string;
  theme: ChatThemeId;
  avatarEmoji: string;
  /** Empty list = any origin may embed. */
  allowedOrigins: string[];
  memoryTurns: number;
  isPublic: boolean;

  /* ---- knowledge base ---- */
  /** Provider id from EMBEDDING_PROVIDERS, or 'none' for keyword-only retrieval. */
  embeddingProvider: string;
  embeddingModel: string;
  /** How many chunks to put in front of the model. */
  retrievalTopK: number;
  /** Show numbered source chips under answers. */
  citations: boolean;
  /** Refuse to answer from general knowledge once the bot has sources. */
  strictGrounding: boolean;

  /* ---- transcripts ---- */
  /**
   * Keep a copy of what visitors said and what the bot answered. Off by
   * default: storing strangers' messages should be a decision someone makes,
   * not something that happens because nobody looked at the setting.
   */
  logConversations: boolean;
  /** Days a stored transcript is kept before it deletes itself. */
  logRetentionDays: number;

  /* ---- bookings ---- */
  /** Adds a "Book" button to the chat; requests land on the manage screen. */
  bookingEnabled: boolean;
  /** What can be booked, shown to visitors and to the model. E.g. "30-min intro call, Mon–Fri". */
  bookingInstructions: string;
}

/** A registered account. Anonymous browser-id owners have no row here. */
/** What an account may do. `admin` unlocks /admin; everyone else is `user`. */
export type UserRole = 'user' | 'admin';

export interface UserDoc {
  id: string;
  email: string;
  /** scrypt, see lib/auth.ts. Never send anywhere near a client. */
  passwordHash: string;
  /** Messages left on the platform's API keys. */
  credits: number;
  /** Absent on accounts created before roles existed — read as 'user'. */
  role?: UserRole;
  createdAt: string;
  /**
   * Sessions issued before this moment (ms) are refused. Bumped by a password
   * reset and by "sign out everywhere"; absent means nothing was ever revoked.
   */
  sessionsValidFrom?: number;
  /** Set once the address has been confirmed by clicking the emailed link. */
  emailVerifiedAt?: string;
  /** Soft-delete marker, so a deletion in flight cannot be logged into. */
  deletedAt?: string;
}

/**
 * The platform's own API key for one provider, set by an admin in /admin.
 *
 * These are what the credits tier and the anonymous trial spend. One document
 * per provider id; `apiKeyEnc` uses the same AES-GCM scheme as bot keys, so it
 * is bound to ENCRYPTION_SECRET and must never leave the server.
 */
export interface PlatformKeyDoc {
  /** Provider id from PROVIDERS. Unique — one key per provider. */
  provider: string;
  apiKeyEnc: string;
  /** Safe to show: first four and last four characters only. */
  apiKeyMask: string;
  /** Email of the admin who last set it, so the panel can show an audit line. */
  updatedBy: string;
  updatedAt: string;
}

/** Stored shape. Never send `apiKeyEnc` anywhere near a client. */
export interface BotDoc extends BotConfig {
  id: string;
  ownerId: string;
  apiKeyEnc: string | null;
  apiKeyMask: string;
  /** Separate key for the embedding provider, when it differs from the chat one. */
  embeddingKeyEnc: string | null;
  embeddingKeyMask: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/* ------------------------------------------------------------------ */
/* Knowledge base                                                       */
/* ------------------------------------------------------------------ */

export type SourceType = 'file' | 'url' | 'sitemap' | 'text' | 'qa';
export type SourceStatus = 'processing' | 'ready' | 'error';

/** One thing the creator added to the bot's knowledge. */
export interface SourceDoc {
  id: string;
  botId: string;
  type: SourceType;
  /** Display name: filename, page title, or a label the creator typed. */
  title: string;
  /** Set for url/sitemap sources so citations can link back. */
  url: string;
  status: SourceStatus;
  /** Only set when status is 'error'. */
  error: string;
  /** Non-fatal note on a source that indexed successfully. */
  warning: string;
  chars: number;
  chunkCount: number;
  /** Pages fetched, for a sitemap or crawled URL. */
  pageCount: number;
  /** Kept so a source can be re-chunked without re-fetching. Empty for large files. */
  rawText: string;
  createdAt: string;
  updatedAt: string;
}

/** A retrievable slice of a source. */
export interface ChunkDoc {
  id: string;
  botId: string;
  sourceId: string;
  /** Position within the source, used to show neighbouring context. */
  index: number;
  title: string;
  url: string;
  text: string;
  /** null when the bot has no embedding provider configured. */
  embedding: number[] | null;
  /** Lowercased token counts, used by the keyword half of retrieval. */
  terms: Record<string, number>;
  length: number;
  createdAt: string;
}

/** What the chat route hands back to the UI alongside the answer. */
export interface Citation {
  n: number;
  title: string;
  url: string;
  snippet: string;
  sourceId: string;
}

/** Safe subset returned to the dashboard (owner-scoped). */
export type BotSummary = Omit<BotDoc, 'apiKeyEnc' | 'embeddingKeyEnc' | '_id'>;

/** Safe subset returned to anyone loading the chat UI. */
export interface PublicBot {
  id: string;
  name: string;
  tagline: string;
  greeting: string;
  placeholder: string;
  suggestions: string[];
  accent: string;
  theme: ChatThemeId;
  avatarEmoji: string;
  model: string;
  provider: string;
  citations: boolean;
  bookingEnabled: boolean;
  bookingInstructions: string;
}

/* ------------------------------------------------------------------ */
/* Bookings                                                             */
/* ------------------------------------------------------------------ */

export type BookingStatus = 'new' | 'confirmed' | 'cancelled';

/** One appointment request a visitor submitted through the chat. */
export interface BookingDoc {
  id: string;
  botId: string;
  name: string;
  /** How to reach them back — email or phone, whatever they typed. */
  contact: string;
  /** The slot they asked for, as they typed it. */
  when: string;
  note: string;
  status: BookingStatus;
  createdAt: string;
  /**
   * Retention cutoff. Absent on rows written before retention existed, which
   * the TTL index simply ignores — those stay until deleted by hand.
   */
  expiresAt?: Date;
}

/* ------------------------------------------------------------------ */
/* Infrastructure collections                                           */
/* ------------------------------------------------------------------ */

/**
 * One rate-limit window. `key` names what is being limited (a bot, an IP, a
 * login attempt), `windowEnd` is when the count resets, and the TTL index on
 * `expiresAt` removes the document shortly after that.
 */
export interface RateDoc {
  key: string;
  count: number;
  windowEnd: number;
  expiresAt: Date;
}

/** A pending password reset. The raw token is only ever in the emailed link. */
export interface ResetDoc {
  /** SHA-256 of the token, so a database dump does not let anyone reset accounts. */
  tokenHash: string;
  userId: string;
  email: string;
  createdAt: string;
  expiresAt: Date;
  /** Set once the token has been spent; a token is never valid twice. */
  usedAt?: string;
}

/** A stored transcript, kept only when the bot's owner turned logging on. */
export interface ConversationDoc {
  id: string;
  botId: string;
  ownerId: string;
  messages: ChatMessage[];
  messageCount: number;
  /** Best-effort visitor grouping, so one chat is one row rather than many. */
  visitorKey: string;
  createdAt: string;
  updatedAt: string;
  /** Retention: the TTL index drops the row on this date. */
  expiresAt: Date;
}

export type LedgerReason =
  | 'admin-grant'
  | 'purchase'
  | 'spend'
  | 'refund'
  | 'signup-bonus';

/**
 * One movement of credits. Every change to a balance writes a row here, so
 * "where did my credits go" has an answer that is not a guess.
 *
 * `reference` is the idempotency key: a Stripe event id, so a webhook Stripe
 * delivers three times still only tops the account up once.
 */
export interface LedgerDoc {
  id: string;
  userId: string;
  /** Positive for a top-up, negative for a spend. */
  delta: number;
  balanceAfter: number;
  reason: LedgerReason;
  note: string;
  reference?: string;
  createdAt: string;
  /**
   * Set on `spend` rows only, which are written once per message and would
   * otherwise outgrow every other collection here. Money movements — purchases,
   * refunds, admin grants — have no expiry and are kept indefinitely.
   */
  expiresAt?: Date;
}
