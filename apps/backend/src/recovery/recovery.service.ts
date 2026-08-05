import { Inject, Injectable, Logger } from '@nestjs/common';
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/kit';
import { randomBytes } from 'node:crypto';
import {
  RECOVERY_SIGNER_STORE,
  type RecoverySignerRow,
  type RecoverySignerStore,
} from './recovery-signer.store';
import {
  DuplicateRecoveryChannelError,
  LastRecoverySignerError,
  UnknownRecoverySignerError,
} from './recovery.errors';
import { RECOVERY_VAULT, type RecoveryVault } from './recovery-vault.interface';

export type RecoveryChannel = 'email' | 'external_wallet';

export interface RecoverySignerSummary {
  id: string;
  address: string;
  channel: RecoveryChannel;
  /** The email address, or the external wallet's own address. */
  channelValue: string;
  createdAt: Date;
  /** False only when this is the Account's sole recovery signer. */
  removable: boolean;
}

/**
 * Manages an Account's recovery signers (S3 in ADR 0025, plus any the Consumer
 * adds later).
 *
 * The rule worth stating loudly: **an Account always keeps at least one recovery
 * signer.** The sole signer can be rotated to a new address but never removed,
 * because the approval signer is deliberately unrecoverable, so a lost phone is
 * recovered with the primary signer plus a recovery signer. Removing the last one
 * turns a lost phone from an inconvenience into permanent loss.
 *
 * Adding a second is what unlocks removing the first. Same shape Fuse uses, and
 * enforced here rather than in the database because the rule is about intent
 * rather than referential integrity.
 */
@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    @Inject(RECOVERY_SIGNER_STORE) private readonly store: RecoverySignerStore,
    @Inject(RECOVERY_VAULT) private readonly vault: RecoveryVault,
  ) {}

  /**
   * Provisions the Account's first recovery signer against the Consumer's email.
   *
   * Silent: called during onboarding once the email is captured, with no key
   * material shown to the Consumer and nothing to write down.
   */
  async provisionEmailSigner(
    userId: string,
    email: string,
  ): Promise<RecoverySignerSummary> {
    const { address, sealed } = await this.mintSealedSigner();

    const row = await this.store.insert({
      userId,
      address,
      channel: 'email',
      channelValue: email.toLowerCase(),
      sealedKey: sealed.ciphertext,
      sealedKeyId: sealed.keyId,
    });

    // Log that it happened. NEVER log the sealed key or the email.
    this.logger.log(`recovery.signer.provisioned user=${userId}`);
    return this.toSummary(row, (await this.store.findByUser(userId)).length);
  }

  async list(userId: string): Promise<RecoverySignerSummary[]> {
    const rows = await this.store.findByUser(userId);
    return rows.map((row) => this.toSummary(row, rows.length));
  }

  /**
   * Adds an external wallet the Consumer already controls. Only its public
   * address is stored, never key material.
   */
  async addExternalWallet(
    userId: string,
    address: string,
  ): Promise<RecoverySignerSummary> {
    await this.assertChannelUnused(userId, 'external_wallet', address);

    const row = await this.store.insert({
      userId,
      address,
      channel: 'external_wallet',
      channelValue: address,
    });

    this.logger.log(`recovery.signer.added user=${userId} channel=wallet`);
    return this.toSummary(row, (await this.store.findByUser(userId)).length);
  }

  async addEmail(
    userId: string,
    email: string,
  ): Promise<RecoverySignerSummary> {
    await this.assertChannelUnused(userId, 'email', email.toLowerCase());
    return this.provisionEmailSigner(userId, email);
  }

  /**
   * Removes a recovery signer, refusing when it is the last one.
   *
   * Returns the removed address so the caller can drive the settings change that
   * takes it out of the on-chain signer set. Removing it here without that
   * follow-up would leave the database and the chain disagreeing.
   */
  async remove(userId: string, signerId: string): Promise<{ address: string }> {
    const rows = await this.store.findByUser(userId);

    const target = rows.find((row) => row.id === signerId);
    if (!target) {
      throw new UnknownRecoverySignerError(
        `no recovery signer ${signerId} for this Account`,
      );
    }
    if (rows.length <= 1) {
      throw new LastRecoverySignerError(
        'an Account must keep at least one recovery signer; add another before removing this one',
      );
    }

    await this.store.deleteById(signerId);
    this.logger.log(`recovery.signer.removed user=${userId}`);
    return { address: target.address };
  }

  /**
   * Rotates an email recovery signer to a new address.
   *
   * This is the escape hatch that makes the at-least-one rule liveable: a
   * Consumer who mistyped their email, or lost access to it, can change it
   * without ever passing through a state with no recovery signer.
   */
  async changeEmail(
    userId: string,
    signerId: string,
    email: string,
  ): Promise<RecoverySignerSummary> {
    const rows = await this.store.findByUser(userId);
    const existing = rows.find((row) => row.id === signerId);

    if (!existing) {
      throw new UnknownRecoverySignerError(
        `no recovery signer ${signerId} for this Account`,
      );
    }
    if (existing.channel !== 'email') {
      throw new UnknownRecoverySignerError(
        `recovery signer ${signerId} is not an email signer`,
      );
    }

    // A fresh keypair, not the old secret re-addressed: the old email may be
    // exactly what was compromised.
    const { address, sealed } = await this.mintSealedSigner();

    const row = await this.store.updateById(signerId, {
      address,
      channelValue: email.toLowerCase(),
      sealedKey: sealed.ciphertext,
      sealedKeyId: sealed.keyId,
    });

    this.logger.log(`recovery.signer.rotated user=${userId}`);
    return this.toSummary(row, rows.length);
  }

  /**
   * Generates a recovery signer and seals its secret.
   *
   * The 32-byte seed is generated here rather than exported from a CryptoKey,
   * because `generateKeyPairSigner` produces a non-extractable key by design and
   * the bytes are needed in order to seal them.
   */
  private async mintSealedSigner() {
    const privateKeyBytes = new Uint8Array(randomBytes(32));
    const signer =
      await createKeyPairSignerFromPrivateKeyBytes(privateKeyBytes);
    const sealed = await this.vault.seal(privateKeyBytes);
    return { address: signer.address, sealed };
  }

  private async assertChannelUnused(
    userId: string,
    channel: RecoveryChannel,
    channelValue: string,
  ): Promise<void> {
    const clash = (await this.store.findByUser(userId)).find(
      (row) => row.channel === channel && row.channelValue === channelValue,
    );
    if (clash) {
      throw new DuplicateRecoveryChannelError(
        'that recovery channel is already on this Account',
      );
    }
  }

  private toSummary(
    row: RecoverySignerRow,
    total: number,
  ): RecoverySignerSummary {
    return {
      id: row.id,
      address: row.address,
      channel: row.channel,
      channelValue: row.channelValue,
      createdAt: row.createdAt,
      removable: total > 1,
    };
  }
}
