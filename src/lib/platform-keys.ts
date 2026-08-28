import { platformKeys } from './mongodb';
import { encrypt, decrypt, maskKey } from './crypto';
import { getProvider } from './providers';
import type { PlatformKeyDoc } from './types';

/**
 * The platform's own provider keys.
 *
 * These used to be environment variables (OPENAI_API_KEY and friends). They now
 * live in the database, encrypted with the same AES-GCM scheme as bot keys, and
 * an admin sets them from /admin. The advantage is that adding a provider — or
 * rotating a leaked key — no longer needs a redeploy; the cost is that the
 * plaintext is only recoverable while ENCRYPTION_SECRET stays put, exactly like
 * every other stored key in the app.
 *
 * Nothing here is cached. A key change has to take effect on the very next
 * message, and one indexed lookup per request is cheap next to the model call
 * that follows it.
 */

/** What the admin panel is allowed to see: never the key itself. */
export interface PlatformKeySummary {
  provider: string;
  label: string;
  mask: string;
  updatedBy: string;
  updatedAt: string;
}

/**
 * The decrypted key for a provider, or null when none is set.
 *
 * A key that fails to decrypt is treated as absent rather than thrown: the
 * caller's job is to fall back to "no platform key", and a broken stored key
 * should degrade to that instead of 500-ing every chat on the platform.
 */
export async function getPlatformKey(providerId: string): Promise<string | null> {
  if (!providerId) return null;
  const col = await platformKeys();
  const doc = await col.findOne({ provider: providerId });
  if (!doc?.apiKeyEnc) return null;
  try {
    return decrypt(doc.apiKeyEnc);
  } catch {
    console.warn(`[chatbot-forge] platform key for ${providerId} could not be decrypted; treating as unset.`);
    return null;
  }
}

/** Store (or replace) the platform key for one provider. */
export async function setPlatformKey(providerId: string, apiKey: string, updatedBy: string): Promise<PlatformKeyDoc> {
  const doc: PlatformKeyDoc = {
    provider: providerId,
    apiKeyEnc: encrypt(apiKey),
    apiKeyMask: maskKey(apiKey),
    updatedBy,
    updatedAt: new Date().toISOString(),
  };
  const col = await platformKeys();
  await col.updateOne({ provider: providerId }, { $set: doc }, { upsert: true });
  return doc;
}

/** Remove the platform key for one provider. Returns whether one was there. */
export async function clearPlatformKey(providerId: string): Promise<boolean> {
  const col = await platformKeys();
  const existing = await col.findOne({ provider: providerId });
  if (!existing) return false;
  await col.deleteOne({ provider: providerId });
  return true;
}

/** Masked summaries for the admin panel — one row per configured provider. */
export async function listPlatformKeys(): Promise<PlatformKeySummary[]> {
  const col = await platformKeys();
  const docs = await col.find({}, { projection: { _id: 0, apiKeyEnc: 0 } }).toArray();
  return docs.map((d) => ({
    provider: d.provider,
    label: getProvider(d.provider)?.label ?? d.provider,
    mask: d.apiKeyMask,
    updatedBy: d.updatedBy,
    updatedAt: d.updatedAt,
  }));
}
