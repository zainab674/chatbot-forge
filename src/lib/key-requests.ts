import { keyRequests } from './mongodb';
import { newId } from './crypto';
import { getProvider } from './providers';
import { KEY_REQUEST_MAX_CHARS } from './platform';
import type { KeyRequestDoc, KeyRequestStatus, UserDoc } from './types';

/**
 * Asking the admin for a key.
 *
 * A creator who has no key of their own and no credits left has, until now,
 * had nowhere to go: the builder told them to paste a key or spend credits and
 * both doors were shut. This is the third door — a short note that lands in
 * /admin with their address and the model they were trying to run.
 *
 * Deciding a request records the decision and nothing else. Approving does not
 * hand out a key or credits, because a single click in a list is the wrong
 * gesture for granting spend; the admin sets the platform key or grants the
 * credits with the panel's existing controls and then marks the request done.
 */

export const KEY_REQUEST_STATUSES: KeyRequestStatus[] = ['pending', 'approved', 'declined'];

/** What either side is allowed to see: the whole document minus the user id. */
export interface KeyRequestView {
  id: string;
  email: string;
  provider: string;
  /** Human-readable provider name, resolved at read time. */
  providerLabel: string;
  model: string;
  reason: string;
  status: KeyRequestStatus;
  createdAt: string;
  updatedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  adminNote: string;
}

function toView(doc: KeyRequestDoc): KeyRequestView {
  return {
    id: doc.id,
    email: doc.email,
    provider: doc.provider,
    providerLabel: getProvider(doc.provider)?.label ?? doc.provider,
    model: doc.model,
    reason: doc.reason,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    decidedBy: doc.decidedBy ?? null,
    decidedAt: doc.decidedAt ?? null,
    adminNote: doc.adminNote ?? '',
  };
}

export type CreateResult = { request: KeyRequestView } | { error: string; status: number };

/**
 * File one request.
 *
 * One pending request per provider, which is what keeps the admin's list worth
 * reading: a creator who wants to nudge is asking about a request that already
 * exists, not filing a second one. It is also the only cap needed, because it
 * bounds an account to at most one open row per entry in PROVIDERS — there is
 * no separate "too many open" rule to get out of step with it.
 */
export async function createKeyRequest(
  user: Pick<UserDoc, 'id' | 'email'>,
  input: { provider: string; model?: string; reason: string },
): Promise<CreateResult> {
  const provider = getProvider(String(input.provider ?? '').trim());
  if (!provider) return { error: 'Pick a provider to ask about.', status: 400 };

  const reason = String(input.reason ?? '').trim().slice(0, KEY_REQUEST_MAX_CHARS);
  if (!reason) return { error: 'Say what you need the key for — the admin sees only this.', status: 400 };

  const col = await keyRequests();
  const waiting = await col.findOne({ userId: user.id, provider: provider.id, status: 'pending' });
  if (waiting) {
    return { error: `You already have a ${provider.label} request waiting. The admin can see it.`, status: 409 };
  }

  const now = new Date().toISOString();
  const doc: KeyRequestDoc = {
    id: newId(),
    userId: user.id,
    email: user.email,
    provider: provider.id,
    // Free text on purpose: a creator may be asking about a model id the
    // catalog does not list yet, which is one of the reasons to ask at all.
    model: String(input.model ?? '').trim().slice(0, 120),
    reason,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  await col.insertOne(doc);
  return { request: toView(doc) };
}

/** One account's own requests, newest first. */
export async function listKeyRequestsFor(userId: string, limit = 20): Promise<KeyRequestView[]> {
  const col = await keyRequests();
  const docs = await col.find({ userId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(limit).toArray();
  return docs.map(toView);
}

/** Everything the admin panel lists, newest first, with the pending count. */
export async function listAllKeyRequests(limit = 200): Promise<{ requests: KeyRequestView[]; pending: number }> {
  const col = await keyRequests();
  const docs = await col.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(limit).toArray();
  return {
    requests: docs.map(toView),
    // Counted over the whole collection rather than the page: a panel that
    // said "0 waiting" because the oldest pending one fell off the limit
    // would be worse than not showing a count at all.
    pending: await col.countDocuments({ status: 'pending' }),
  };
}

export type DecideResult = { request: KeyRequestView } | { error: string; status: number };

/** Mark one request approved or declined, with an optional reply. */
export async function decideKeyRequest(
  id: string,
  status: KeyRequestStatus,
  adminEmail: string,
  note = '',
): Promise<DecideResult> {
  if (!KEY_REQUEST_STATUSES.includes(status) || status === 'pending') {
    return { error: 'A decision is either "approved" or "declined".', status: 400 };
  }

  const col = await keyRequests();
  const existing = await col.findOne({ id }, { projection: { _id: 0 } });
  if (!existing) return { error: 'That request no longer exists.', status: 404 };

  const decided: KeyRequestDoc = {
    ...existing,
    status,
    updatedAt: new Date().toISOString(),
    decidedBy: adminEmail,
    decidedAt: new Date().toISOString(),
    adminNote: String(note ?? '').trim().slice(0, KEY_REQUEST_MAX_CHARS),
  };
  await col.updateOne(
    { id },
    {
      $set: {
        status: decided.status,
        updatedAt: decided.updatedAt,
        decidedBy: decided.decidedBy,
        decidedAt: decided.decidedAt,
        adminNote: decided.adminNote,
      },
    },
  );
  return { request: toView(decided) };
}
