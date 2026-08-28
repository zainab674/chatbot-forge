import crypto from 'crypto';

/**
 * Creator API keys are encrypted at rest with AES-256-GCM so that a dump of the
 * Mongo collection does not hand over everyone's provider keys. The key is
 * derived from ENCRYPTION_SECRET; rotating that secret invalidates stored keys.
 */

function key(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'ENCRYPTION_SECRET is missing or too short. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return crypto.createHash('sha256').update(secret).digest();
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

export function decrypt(payload: string): string {
  const [version, iv, tag, data] = payload.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Malformed encrypted value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

/** "sk-proj-abcd...wxyz" -> "sk-p••••wxyz", safe to show back to the creator. */
export function maskKey(plain: string): string {
  if (!plain) return '';
  if (plain.length <= 10) return '••••••';
  return `${plain.slice(0, 4)}••••${plain.slice(-4)}`;
}

export function newId(bytes = 9): string {
  return crypto.randomBytes(bytes).toString('base64url');
}
