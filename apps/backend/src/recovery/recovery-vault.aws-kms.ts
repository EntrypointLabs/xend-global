import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KMS_CLIENT, type KmsClient } from './kms.client';
import { EnvRecoveryVault } from './recovery-vault.env';
import type { RecoveryVault, SealedKey } from './recovery-vault.interface';
import { aesGcmOpen, aesGcmSeal } from './recovery-vault.keys';

export const KMS_KEY_ID_PREFIX = 'aws-kms:';

/**
 * Envelope custody. Every seal asks KMS for a fresh AES-256 data key, seals
 * the secret under it in process memory, and stores the data key's KMS
 * ciphertext beside the sealed key. Opening reverses that with one Decrypt.
 * The wrapping key never leaves KMS, so unsealing is bounded by KMS audit and
 * IAM rather than by who can read the environment.
 *
 * Rows sealed under an env key still open here while the env keys stay
 * configured, which is what lets a cutover run reseal on a live deployment
 * instead of racing the last env-sealed row.
 */
@Injectable()
export class KmsRecoveryVault implements RecoveryVault {
  private readonly logger = new Logger(KmsRecoveryVault.name);
  private announced = false;

  constructor(
    private readonly config: ConfigService,
    @Inject(KMS_CLIENT) private readonly kms: KmsClient,
    private readonly envFallback: EnvRecoveryVault,
  ) {}

  private get kmsKeyId(): string {
    const keyId = this.config.get<string>('RECOVERY_VAULT_KMS_KEY_ID');
    if (!keyId) {
      throw new Error('RECOVERY_VAULT_KMS_KEY_ID is required');
    }
    if (!this.announced) {
      this.announced = true;
      this.logger.log(`recovery.vault.ready provider=aws-kms keyId=${keyId}`);
    }
    return keyId;
  }

  get currentKeyId(): string {
    return `${KMS_KEY_ID_PREFIX}${this.kmsKeyId}`;
  }

  async seal(secretKey: Uint8Array): Promise<SealedKey> {
    const dataKey = await this.kms.generateDataKey(this.kmsKeyId);
    const key = Buffer.from(dataKey.plaintext);
    try {
      return {
        ciphertext: aesGcmSeal(key, secretKey),
        keyId: this.currentKeyId,
        wrappedDataKey: Buffer.from(dataKey.ciphertext).toString('base64'),
      };
    } finally {
      key.fill(0);
    }
  }

  async open(sealed: SealedKey): Promise<Uint8Array> {
    if (!sealed.keyId.startsWith(KMS_KEY_ID_PREFIX)) {
      if (this.envFallbackHolds(sealed.keyId)) {
        return this.envFallback.open(sealed);
      }
      throw new Error(`sealed under an unknown key: ${sealed.keyId}`);
    }
    if (!sealed.wrappedDataKey) {
      throw new Error(
        `sealed under ${sealed.keyId} but carries no wrapped data key`,
      );
    }
    const key = Buffer.from(
      await this.kms.decrypt(Buffer.from(sealed.wrappedDataKey, 'base64')),
    );
    try {
      return aesGcmOpen(key, sealed.ciphertext);
    } finally {
      key.fill(0);
    }
  }

  private envFallbackHolds(keyId: string): boolean {
    try {
      return this.envFallback.holds(keyId);
    } catch {
      return false;
    }
  }
}
