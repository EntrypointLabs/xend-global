import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { RecoveryVault, SealedKey } from './recovery-vault.interface';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_ID = 'env-v1';

/**
 * Env-key recovery vault. AES-256-GCM under RECOVERY_VAULT_KEY.
 *
 * Pilot floor only. Custody order is KMS > cloud-KMS > raw env, and the `keyId`
 * on every sealed key is what makes moving up that order a migration rather
 * than a rewrite.
 */
@Injectable()
export class EnvRecoveryVault implements RecoveryVault, OnModuleInit {
  private readonly logger = new Logger(EnvRecoveryVault.name);
  private key!: Buffer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const raw = this.config.getOrThrow<string>('RECOVERY_VAULT_KEY');
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
      throw new Error(
        `RECOVERY_VAULT_KEY must decode to 32 bytes, got ${key.length}`,
      );
    }
    this.key = key;
    // Log readiness only. NEVER log the key or any sealed payload.
    this.logger.log(`recovery.vault.ready keyId=${KEY_ID}`);
  }

  seal(secretKey: Uint8Array): Promise<SealedKey> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const sealed = Buffer.concat([
      cipher.update(Buffer.from(secretKey)),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Promise.resolve({
      ciphertext: Buffer.concat([iv, tag, sealed]).toString('base64'),
      keyId: KEY_ID,
    });
  }

  open(sealed: SealedKey): Promise<Uint8Array> {
    // keyId is not secret, so a plain compare is fine here.
    if (sealed.keyId !== KEY_ID) {
      throw new Error(`sealed under an unknown key: ${sealed.keyId}`);
    }
    const raw = Buffer.from(sealed.ciphertext, 'base64');
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + 16);
    const body = raw.subarray(IV_BYTES + 16);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Promise.resolve(
      new Uint8Array(Buffer.concat([decipher.update(body), decipher.final()])),
    );
  }
}
