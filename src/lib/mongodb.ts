import { MongoClient, Db, Collection, Document, IndexSpecification, CreateIndexesOptions } from 'mongodb';
import type {
  BotDoc,
  SourceDoc,
  ChunkDoc,
  UserDoc,
  BookingDoc,
  PlatformKeyDoc,
  RateDoc,
  ResetDoc,
  ConversationDoc,
  LedgerDoc,
} from './types';
import * as fake from './mongodb.fake';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'chatbot_forge';

/**
 * Test escape hatch: `npm run test:e2e` sets CF_FAKE_DB=1 so the whole app can
 * run against an in-process store. Never set this in production.
 *
 * Read on every call rather than captured at import: the unit tests switch it
 * on after the module graph has already loaded, and a captured constant would
 * have silently sent them at a database that is not there.
 */
const fakeDb = () => process.env.CF_FAKE_DB === '1';

if (!uri && !fakeDb()) {
  // Warn rather than throw at import time, so pages still render with a
  // helpful message instead of a blank 500.
  console.warn('[chatbot-forge] MONGODB_URI is not set. Copy .env.example to .env.local.');
}

declare global {
  // eslint-disable-next-line no-var
  var _cfMongo: { client: MongoClient; promise: Promise<MongoClient> } | undefined;
}

function getClient(): Promise<MongoClient> {
  if (!uri) throw new Error('MONGODB_URI is not set. Add it to .env.local.');
  if (!global._cfMongo) {
    const client = new MongoClient(uri, { maxPoolSize: 10 });
    global._cfMongo = { client, promise: client.connect() };
  }
  return global._cfMongo.promise;
}

export async function getDb(): Promise<Db> {
  if (fakeDb()) return fake.getDb();
  const client = await getClient();
  return client.db(dbName);
}

const indexed = new Set<string>();

/**
 * An index to create, optionally with options — `unique` for the ones that are
 * enforcing a rule rather than speeding up a query, and `expireAfterSeconds`
 * for the collections that clean up after themselves.
 */
type IndexSpec = IndexSpecification | { key: IndexSpecification; options: CreateIndexesOptions };

/** Creates each collection's indexes once per process, then gets out of the way. */
async function collection<T extends Document>(name: string, indexes: IndexSpec[] = []): Promise<Collection<T>> {
  if (fakeDb()) return fake.collection(name);

  const db = await getDb();
  const col = db.collection<T>(name);
  if (!indexed.has(name)) {
    indexed.add(name);
    await Promise.all(
      indexes.map((spec) =>
        'key' in (spec as any) && 'options' in (spec as any)
          ? col.createIndex((spec as any).key, (spec as any).options)
          : col.createIndex(spec as IndexSpecification),
      ),
    ).catch((e) => {
      indexed.delete(name);
      console.warn(`[chatbot-forge] index creation failed on ${name}:`, e?.message);
    });
  }
  return col;
}

export function bots(): Promise<Collection<BotDoc>> {
  return collection<BotDoc>('bots', [{ id: 1 }, { ownerId: 1, createdAt: -1 }]);
}

/** One row per thing the creator added: a file, a URL, a sitemap, text, or Q&A. */
export function sources(): Promise<Collection<SourceDoc>> {
  return collection<SourceDoc>('sources', [{ id: 1 }, { botId: 1, createdAt: -1 }]);
}

/** The retrievable pieces. `embedding` is null when the bot runs keyword-only. */
export function chunks(): Promise<Collection<ChunkDoc>> {
  return collection<ChunkDoc>('chunks', [{ botId: 1 }, { sourceId: 1 }, { id: 1 }]);
}

/**
 * Registered accounts.
 *
 * The email index is `unique` because the signup route cannot enforce this on
 * its own: it checks with findOne and then inserts, and two requests that
 * interleave between those two calls both see "no such account" and both
 * insert. The loser of that race now gets a duplicate-key error, which signup
 * turns back into "that email is already registered".
 */
export function users(): Promise<Collection<UserDoc>> {
  return collection<UserDoc>('users', [
    { id: 1 },
    { key: { email: 1 }, options: { unique: true } },
  ]);
}

/**
 * Rate-limit counters, shared by every instance.
 *
 * Serverless hosts run many copies of this app at once and recycle them
 * constantly, so an in-process counter limits nothing. Documents expire on
 * their own via the TTL index; nothing ever deletes them by hand.
 */
export function rateLimits(): Promise<Collection<RateDoc>> {
  return collection<RateDoc>('ratelimits', [
    { key: { key: 1 }, options: { unique: true } },
    { key: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
  ]);
}

/** Outstanding password-reset tokens. Single-use, and they expire themselves. */
export function passwordResets(): Promise<Collection<ResetDoc>> {
  return collection<ResetDoc>('passwordResets', [
    { key: { tokenHash: 1 }, options: { unique: true } },
    { userId: 1 },
    { key: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
  ]);
}

/** Stored transcripts, when the bot's owner has logging switched on. */
export function conversations(): Promise<Collection<ConversationDoc>> {
  return collection<ConversationDoc>('conversations', [
    { id: 1 },
    { botId: 1, updatedAt: -1 },
    { key: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
  ]);
}

/**
 * Every credit movement, so a balance can always be explained.
 *
 * The TTL index only ever removes `spend` rows, which are the ones that carry
 * an `expiresAt` — a busy bot writes one per message. Purchases and refunds
 * have no expiry set, and a TTL index ignores documents missing the field.
 */
export function ledger(): Promise<Collection<LedgerDoc>> {
  return collection<LedgerDoc>('ledger', [
    { id: 1 },
    { userId: 1, createdAt: -1 },
    { key: { reference: 1 }, options: { unique: true, sparse: true } },
    { key: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
  ]);
}

/**
 * The platform's own provider keys, set by an admin in /admin. One document per
 * provider; these replaced the OPENAI_API_KEY-style environment variables.
 */
export function platformKeys(): Promise<Collection<PlatformKeyDoc>> {
  return collection<PlatformKeyDoc>('platformKeys', [{ provider: 1 }]);
}

/**
 * Appointment requests visitors submitted through a bot's Book button.
 *
 * These hold a stranger's name and contact details, so they expire: the TTL
 * index drops each one on its own `expiresAt`, set from BOOKING_RETENTION_DAYS
 * when it is written. Keeping personal data indefinitely because nothing ever
 * deleted it is the default this avoids.
 */
export function bookings(): Promise<Collection<BookingDoc>> {
  return collection<BookingDoc>('bookings', [
    { id: 1 },
    { botId: 1, createdAt: -1 },
    { key: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
  ]);
}
