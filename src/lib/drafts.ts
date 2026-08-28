import { bots, bookings } from './mongodb';
import { deleteAllKnowledge } from './knowledge/ingest';
import { deleteTranscripts } from './transcripts';
import { ANON_PREFIX } from './auth';

/**
 * Anonymous drafts nobody claims eventually get swept, so abandoned funnels do
 * not pile up in the collection forever. Claimed bots are safe: signup/login
 * rewrites ownerId to the account id, which no longer matches the prefix.
 */
const MAX_AGE_DAYS = 30;
/** Small batch per call — this runs piggybacked on a request, not as a job. */
const SWEEP_BATCH = 20;

/** Fire-and-forget from the create route; never await this on the hot path. */
export async function sweepStaleAnonDrafts(): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000).toISOString();
  const col = await bots();
  const stale = await col
    .find(
      { ownerId: { $regex: `^${ANON_PREFIX}` }, updatedAt: { $lt: cutoff } },
      { projection: { _id: 0, id: 1 } },
    )
    .limit(SWEEP_BATCH)
    .toArray();
  if (!stale.length) return;

  const ids = stale.map((b) => b.id as string);
  await col.deleteMany({ id: { $in: ids } });
  // Same cleanup a manual delete does, so nothing is orphaned.
  const bookingsCol = await bookings();
  for (const id of ids) {
    await deleteAllKnowledge(id).catch(() => {});
    await bookingsCol.deleteMany({ botId: id }).catch(() => {});
    await deleteTranscripts(id).catch(() => {});
  }
}
