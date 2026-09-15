import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RecoveryVault, SealedKey } from './recovery-vault.interface';
import {
  aesGcmOpen,
  aesGcmSeal,
  parseVaultKeyRing,
  type VaultKeyRing,
} from './recovery-vault.keys';

/**
 * Env-key recovery vault. AES-256-GCM under the current key in
 * RECOVERY_VAULT_KEYS (or RECOVERY_VAULT_KEY as the single `env-v1` key).
 *
 * Pilot floor only. Custody order is KMS > cloud-KMS > raw env, and the `keyId`
 * on every sealed key is what makes moving up that order a migration rather
 * than a rewrite: old rows open under the key they name, new seals take the
 * current one, and `reseal-recovery-signers.ts` closes the gap.
 */
@Injectable()
export class EnvRecoveryVault implements RecoveryVault {
  private readonly logger = new Logger(EnvRecoveryVault.name);
  private cached?: VaultKeyRing;

  constructor(private readonly config: ConfigService) {}

  /**
   * Resolved on first seal or open rather than at module init, so a deployment
   * without a vault key boots and serves every other route. Recovery is the
   * only thing that fails, and it fails where it is called.
   */
  private get ring(): VaultKeyRing {
    if (this.cached) return this.cached;
    const ring = parseVaultKeyRing(this.config);
    if (!ring) {
      throw new Error('RECOVERY_VAULT_KEYS or RECOVERY_VAULT_KEY is required');
    }
    this.cached = ring;
    // Log readiness only. NEVER log the key or any sealed payload.
    this.logger.log(
      `recovery.vault.ready provider=env keyId=${ring.current.id} keys=${ring.byId.size}`,
    );
    return ring;
  }

  get currentKeyId(): string {
    return this.ring.current.id;
  }

  /** Whether a sealed key names one of the env keys this vault holds. */
  holds(keyId: string): boolean {
    return this.ring.byId.has(keyId);
  }

  // Async so a missing or unknown key rejects the call rather than throwing
  // out of it: every caller awaits, and a synchronous throw would escape the
  // handler that is meant to turn this into a refusal.
  seal(secretKey: Uint8Array): Promise<SealedKey> {
    try {
      const { current } = this.ring;
      return Promise.resolve({
        ciphertext: aesGcmSeal(current.key, secretKey),
        keyId: current.id,
        wrappedDataKey: null,
      });
    } catch (err) {
      return Promise.reject(err as Error);
    }
  }

  open(sealed: SealedKey): Promise<Uint8Array> {
    try {
      const key = this.ring.byId.get(sealed.keyId);
      if (!key) {
        throw new Error(`sealed under an unknown key: ${sealed.keyId}`);
      }
      return Promise.resolve(aesGcmOpen(key.key, sealed.ciphertext));
    } catch (err) {
      return Promise.reject(err as Error);
    }
  }
}
