/**
 * TEST DOUBLE — not used in production.
 *
 * `mongodb.ts` delegates to this file only when CF_FAKE_DB=1, which
 * `npm run test:e2e` and `npm run test:visual` set. It implements the small
 * slice of the Mongo collection API the app actually uses, backed by plain
 * arrays, so the end-to-end tests can exercise every route without a database.
 */
const stores = new Map<string, any[]>();

function store(name: string): any[] {
  if (!stores.has(name)) stores.set(name, []);
  return stores.get(name)!;
}

/**
 * Fields carrying a unique index, per collection.
 *
 * Worth the handful of lines because a unique index here is not a performance
 * hint — it is the rule the app leans on. `grantCredits` decides whether a
 * Stripe payment has already been honoured purely from whether inserting its
 * ledger row raises a duplicate key, so a test double that quietly accepts
 * every insert would report that logic as working no matter what it did.
 */
const uniques = new Map<string, Set<string>>();

function uniqueFields(name: string): Set<string> {
  if (!uniques.has(name)) uniques.set(name, new Set());
  return uniques.get(name)!;
}

/** Registers `{ key, options: { unique: true } }` specs from mongodb.ts. */
export function registerIndexes(name: string, indexes: any[] = []): void {
  for (const spec of indexes) {
    if (!spec || !('key' in spec) || !spec.options?.unique) continue;
    for (const field of Object.keys(spec.key)) uniqueFields(name).add(field);
  }
}

class DuplicateKeyError extends Error {
  code = 11000;
  constructor(field: string) {
    super(`E11000 duplicate key error collection: index: ${field}_1 dup key`);
  }
}

/**
 * Every unique index in this app is sparse in effect — a document without the
 * field does not participate — so an absent value never collides.
 */
function assertUnique(name: string, doc: any): void {
  for (const field of uniqueFields(name)) {
    const value = doc?.[field];
    if (value === undefined || value === null) continue;
    if (store(name).some((d) => d[field] === value)) throw new DuplicateKeyError(field);
  }
}

function matches(doc: any, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([k, v]) => {
    if (k === '$or') return (v as any[]).some((sub) => matches(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      if ('$in' in v) return (v.$in as any[]).includes(doc[k]);
      if ('$nin' in v) return !(v.$nin as any[]).includes(doc[k]);
      if ('$ne' in v) return doc[k] !== v.$ne;
      if ('$regex' in v) return new RegExp(v.$regex).test(String(doc[k] ?? ''));
      if ('$exists' in v) return (doc[k] !== undefined) === Boolean(v.$exists);
      if ('$lt' in v) return doc[k] < v.$lt;
      if ('$lte' in v) return doc[k] <= v.$lte;
      if ('$gt' in v) return doc[k] > v.$gt;
      if ('$gte' in v) return doc[k] >= v.$gte;
    }
    return doc[k] === v;
  });
}

function project<T extends Record<string, any>>(doc: T, projection?: Record<string, 0 | 1>): any {
  if (!projection) return { ...doc };
  const excludes = Object.entries(projection).filter(([, v]) => v === 0).map(([k]) => k);
  const copy: any = { ...doc };
  for (const k of excludes) delete copy[k];
  return copy;
}

interface Update {
  $set?: Record<string, any>;
  $inc?: Record<string, number>;
  $setOnInsert?: Record<string, any>;
  $push?: Record<string, any>;
  $unset?: Record<string, any>;
}

function apply(doc: Record<string, any>, update: Update) {
  if (update.$set) Object.assign(doc, update.$set);
  if (update.$unset) for (const k of Object.keys(update.$unset)) delete doc[k];
  if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] ?? 0) + v;
  if (update.$push) {
    for (const [k, v] of Object.entries(update.$push)) {
      const each = (v as any)?.$each;
      doc[k] = [...(doc[k] ?? []), ...(Array.isArray(each) ? each : [v])];
    }
  }
}

/**
 * Real Mongo builds an upserted document from the filter's equality terms plus
 * $set / $setOnInsert / $inc; that is all the app relies on.
 */
function upsert(filter: Record<string, any>, update: Update): Record<string, any> {
  const created: Record<string, any> = {};
  for (const [k, v] of Object.entries(filter)) {
    if (v === null || typeof v !== 'object') created[k] = v;
  }
  Object.assign(created, update.$setOnInsert ?? {}, update.$set ?? {});
  if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) created[k] = v;
  if (update.$push) {
    for (const [k, v] of Object.entries(update.$push)) {
      const each = (v as any)?.$each;
      created[k] = Array.isArray(each) ? [...each] : [v];
    }
  }
  return created;
}

function fakeCollection(name: string) {
  const rows = () => store(name);
  return {
    async createIndex() {
      return 'ok';
    },
    find(filter: Record<string, any> = {}, opts: { projection?: Record<string, 0 | 1> } = {}) {
      let found = rows().filter((d) => matches(d, filter));
      const api = {
        sort(spec: Record<string, 1 | -1>) {
          const [field, dir] = Object.entries(spec)[0] ?? ['createdAt', -1];
          found = [...found].sort((a: any, b: any) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * dir);
          return api;
        },
        limit(n: number) {
          found = found.slice(0, n);
          return api;
        },
        async toArray() {
          return found.map((d) => project(d, opts.projection));
        },
      };
      return api;
    },
    async findOne(filter: Record<string, any>, opts: { projection?: Record<string, 0 | 1> } = {}) {
      const doc = rows().find((d) => matches(d, filter));
      return doc ? project(doc, opts.projection) : null;
    },
    async countDocuments(filter: Record<string, any> = {}) {
      return rows().filter((d) => matches(d, filter)).length;
    },
    async insertOne(doc: any) {
      assertUnique(name, doc);
      rows().push({ ...doc });
      return { acknowledged: true };
    },
    async insertMany(docs: any[]) {
      for (const d of docs) {
        assertUnique(name, d);
        rows().push({ ...d });
      }
      return { acknowledged: true, insertedCount: docs.length };
    },
    async updateOne(
      filter: Record<string, any>,
      update: Update,
      opts: { upsert?: boolean } = {},
    ) {
      const doc = rows().find((d) => matches(d, filter));
      if (!doc) {
        if (!opts.upsert) return { matchedCount: 0, upsertedCount: 0 };
        rows().push(upsert(filter, update));
        return { matchedCount: 0, upsertedCount: 1 };
      }
      apply(doc, update);
      return { matchedCount: 1, upsertedCount: 0 };
    },
    /** Enough of the real signature for the rate limiter and the credit ledger. */
    async findOneAndUpdate(
      filter: Record<string, any>,
      update: Update,
      opts: { upsert?: boolean; returnDocument?: 'before' | 'after' } = {},
    ) {
      const before = rows().find((d) => matches(d, filter));
      if (!before) {
        if (!opts.upsert) return null;
        const created = upsert(filter, update);
        rows().push(created);
        return opts.returnDocument === 'after' ? { ...created } : null;
      }
      const snapshot = { ...before };
      apply(before, update);
      return opts.returnDocument === 'after' ? { ...before } : snapshot;
    },
    async updateMany(filter: Record<string, any>, update: Update) {
      let n = 0;
      for (const doc of rows()) {
        if (!matches(doc, filter)) continue;
        apply(doc, update);
        n++;
      }
      return { matchedCount: n, modifiedCount: n };
    },
    async deleteOne(filter: Record<string, any>) {
      const list = rows();
      const i = list.findIndex((d) => matches(d, filter));
      if (i >= 0) list.splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    },
    async deleteMany(filter: Record<string, any>) {
      const list = rows();
      let n = 0;
      for (let i = list.length - 1; i >= 0; i--) {
        if (matches(list[i], filter)) {
          list.splice(i, 1);
          n++;
        }
      }
      return { deletedCount: n };
    },
    /** Atlas-only in production; the fake never advertises it, so callers fall back. */
    aggregate() {
      throw new Error('aggregate is not supported by the test store');
    },
  };
}

export async function collection(name: string, indexes: any[] = []): Promise<any> {
  registerIndexes(name, indexes);
  return fakeCollection(name);
}

export async function getDb(): Promise<any> {
  return { collection: (name: string) => fakeCollection(name) };
}
