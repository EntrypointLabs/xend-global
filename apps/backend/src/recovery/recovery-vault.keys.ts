import type { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const LEGACY_ENV_KEY_ID = 'env-v1';

export interface VaultKey {
  id: string;
  key: Buffer;
}

export interface VaultKeyRing {
  current: VaultKey;
  byId: Map<string, VaultKey>;
}

/**
 * RECOVERY_VAULT_KEYS is `id:base64,id:base64,...` with the current key first.
 * Falls back to RECOVERY_VAULT_KEY as the single `env-v1` key so a deployment
 * that never rotated keeps working unchanged.
 */
export function parseVaultKeyRing(
  config: Pick<ConfigService, 'get'>,
): VaultKeyRing | null {
  const list = config.get<string>('RECOVERY_VAULT_KEYS');
  const entries: VaultKey[] = [];
  if (list && list.trim()) {
    for (const entry of list.split(',')) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const separator = trimmed.indexOf(':');
      if (separator <= 0) {
        throw new Error(
          'RECOVERY_VAULT_KEYS entries must be id:base64 (id may not be empty)',
        );
      }
      entries.push({
        id: trimmed.slice(0, separator),
        key: decodeKey(
          trimmed.slice(separator + 1),
          trimmed.slice(0, separator),
        ),
      });
    }
  } else {
    const single = config.get<string>('RECOVERY_VAULT_KEY');
    if (single) {
      entries.push({
        id: LEGACY_ENV_KEY_ID,
        key: decodeKey(single, LEGACY_ENV_KEY_ID),
      });
    }
  }
  if (entries.length === 0) return null;

  const byId = new Map<string, VaultKey>();
  for (const entry of entries) {
    if (byId.has(entry.id)) {
      throw new Error(`RECOVERY_VAULT_KEYS lists ${entry.id} twice`);
    }
    byId.set(entry.id, entry);
  }
  return { current: entries[0], byId };
}

function decodeKey(base64: string, id: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `recovery vault key ${id} must decode to 32 bytes, got ${key.length}`,
    );
  }
  return key;
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM, laid out as iv || tag || body and base64 encoded. */
export function aesGcmSeal(key: Buffer, plaintext: Uint8Array): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const body = Buffer.concat([
    cipher.update(Buffer.from(plaintext)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function aesGcmOpen(key: Buffer, ciphertext: string): Uint8Array {
  const raw = Buffer.from(ciphertext, 'base64');
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return new Uint8Array(
    Buffer.concat([decipher.update(body), decipher.final()]),
  );
}
