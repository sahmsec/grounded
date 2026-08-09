/**
 * Encryption for stored API keys.
 *
 * AES-256-GCM from node:crypto — authenticated, so tampering is detected
 * rather than silently decrypting to garbage. The master key comes from the
 * environment and never touches the database: keeping it beside the
 * ciphertext would make the encryption decorative.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ConfigError } from '../errors/index.ts';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * Accepts either 64 hex characters (32 bytes, preferred) or any passphrase,
 * which is hashed to 32 bytes. Hashing a short passphrase does not add
 * entropy, so generate a real one — the admin page says so too.
 */
function keyFrom(master: string): Buffer {
  const trimmed = master.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return Buffer.from(trimmed, 'hex');
  return createHash('sha256').update(trimmed).digest();
}

export interface Cipher {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
}

export function createCipher(master: string | undefined): Cipher {
  if (!master || master.trim().length < 16) {
    throw new ConfigError(
      'ADMIN_MASTER_KEY must be set to at least 16 characters before credentials can be stored. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }

  const key = keyFrom(master);

  return {
    encrypt(plaintext) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(
        ':',
      );
    },

    decrypt(payload) {
      const [ivPart, tagPart, dataPart] = payload.split(':');
      if (!ivPart || !tagPart || !dataPart) {
        throw new ConfigError('Stored credential is malformed');
      }
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64'));
      decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
      // Throws if the master key changed or the row was tampered with, which
      // is the point of using an authenticated mode.
      return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()]).toString(
        'utf8',
      );
    },
  };
}

/** Last four characters, for identifying a key without revealing it. */
export function hintFor(secret: string): string {
  return secret.length <= 4 ? '••••' : secret.slice(-4);
}
