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
  RecoveryChangeInFlightError,
  RecoverySignerLimitError,
  UnknownRecoverySignerError,
} from './recovery.errors';
import { RECOVERY_VAULT, type RecoveryVault } from './recovery-vault.interface';

export type RecoveryChannel = 'email' | 'external_wallet';

export type RecoverySignerStatus = 'pending_add' | 'active' | 'pending_remove';

/**
 * How many recovery signers an Account may carry (D10).
 *
 * Each one adds pairs that meet the Settings threshold, so this is a cap on
 * blast radius rather than an arbitrary product limit.
 */
export const MAX_RECOVERY_SIGNERS = 3;

export interface RecoverySignerSummary {
  id: string;
  address: string;
  channel: RecoveryChannel;
  /** The email address, or the external wallet's own address. */
  channelValue: string;
  createdAt: Date;
  status: RecoverySignerStatus;
  /**
   * False when removing this signer would leave the Account with none, and
   * while any change to it is still in flight.
   */
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
    // Active on sight. This one joins the signer set as part of Account
    // creation rather than through a settings change, so there is no window
    // in which the row and the chain disagree.
    const row = await this.insertEmailSigner(userId, email, 'active');

    // Log that it happened. NEVER log the sealed key or the email.
    this.logger.log(`recovery.signer.provisioned user=${userId}`);
    return this.summarise(row, await this.store.findByUser(userId));
  }

  /**
   * The onboarding entry point, safe to call again after a failed enrolment.
   *
   * Enrolment does the on-chain create *after* this, so it can fail with the
   * signer already stored, and the Consumer retries. Minting a second one then
   * violates the (user, channel, value) uniqueness and fails the retry before
   * it reaches the chain, which strands the Account permanently. Reusing the
   * stored signer costs nothing: its address comes from a sealed key held
   * here, and a failed attempt consumed none of it.
   *
   * Distinct from `addEmail`, which is a Consumer deliberately adding a signer
   * and must refuse a duplicate rather than quietly return the existing one.
   */
  async ensureEmailSigner(
    userId: string,
    email: string,
  ): Promise<RecoverySignerSummary> {
    const channelValue = email.toLowerCase();
    const rows = await this.store.findByUser(userId);
    const existing = rows.find(
      (row) => row.channel === 'email' && row.channelValue === channelValue,
    );

    if (existing) {
      this.logger.log(`recovery.signer.reused user=${userId}`);
      return this.summarise(existing, rows);
    }

    return this.provisionEmailSigner(userId, email);
  }

  async list(userId: string): Promise<RecoverySignerSummary[]> {
    const rows = await this.store.findByUser(userId);
    return rows.map((row) => this.summarise(row, rows));
  }

  /**
   * Adds an external wallet the Consumer already controls. Only its public
   * address is stored, never key material.
   *
   * Staged, not active: the caller has to land the settings change that puts it
   * in the on-chain signer set before it recovers anything.
   */
  async addExternalWallet(
    userId: string,
    address: string,
  ): Promise<RecoverySignerSummary> {
    const rows = await this.assertRoomForAnother(userId);
    this.assertChannelUnused(rows, 'external_wallet', address);
    if (rows.some((row) => row.address === address)) {
      throw new DuplicateRecoveryChannelError(
        'that address is already a signer on this Account',
      );
    }

    const row = await this.store.insert({
      userId,
      address,
      channel: 'external_wallet',
      channelValue: address,
      status: 'pending_add',
    });

    this.logger.log(`recovery.signer.staged user=${userId} channel=wallet`);
    return this.summarise(row, [...rows, row]);
  }

  async addEmail(
    userId: string,
    email: string,
  ): Promise<RecoverySignerSummary> {
    const rows = await this.assertRoomForAnother(userId);
    this.assertChannelUnused(rows, 'email', email.toLowerCase());

    const row = await this.insertEmailSigner(userId, email, 'pending_add');
    this.logger.log(`recovery.signer.staged user=${userId} channel=email`);
    return this.summarise(row, [...rows, row]);
  }

  /**
   * Stages the removal of a recovery signer, refusing when it is the last one.
   *
   * The row is marked rather than deleted, and returns the address so the
   * caller can drive the settings change that takes it out of the on-chain
   * signer set. Deleting it here would leave the database claiming the Account
   * has fewer signers than the chain does, and the difference would only
   * surface when somebody tried to recover.
   */
  async remove(userId: string, signerId: string): Promise<{ address: string }> {
    const rows = await this.store.findByUser(userId);
    this.assertNoChangeInFlight(rows);

    const target = rows.find((row) => row.id === signerId);
    if (!target) {
      throw new UnknownRecoverySignerError(
        `no recovery signer ${signerId} for this Account`,
      );
    }
    if (target.status !== 'active') {
      throw new UnknownRecoverySignerError(
        `recovery signer ${signerId} is not active`,
      );
    }
    // Counts what actually backs the Account on chain. A pending_add row is
    // not in the signer set yet, so it cannot be what makes this one spare.
    if (backing(rows).length <= 1) {
      throw new LastRecoverySignerError(
        'an Account must keep at least one recovery signer; add another before removing this one',
      );
    }

    await this.store.updateById(signerId, { status: 'pending_remove' });
    this.logger.log(`recovery.signer.removal_staged user=${userId}`);
    return { address: target.address };
  }

  /**
   * Records which settings change carries this signer, so the two can be
   * reconciled when it executes or is rejected.
   */
  async markChange(signerId: string, changeIndex: bigint): Promise<void> {
    await this.store.updateById(signerId, {
      changeIndex: changeIndex.toString(),
    });
  }

  /** The open change for this Account, if one is in flight. */
  async pendingChange(
    userId: string,
  ): Promise<{ signerId: string; changeIndex: bigint } | null> {
    const row = (await this.store.findByUser(userId)).find(
      (candidate) => candidate.changeIndex !== null,
    );
    return row
      ? { signerId: row.id, changeIndex: BigInt(row.changeIndex as string) }
      : null;
  }

  /**
   * Applies a settings change that executed: staged additions become real, and
   * staged removals drop out. Idempotent, because the caller polls.
   */
  async settle(userId: string, changeIndex: bigint): Promise<void> {
    for (const row of await this.rowsInChange(userId, changeIndex)) {
      if (row.status === 'pending_add') {
        await this.store.updateById(row.id, {
          status: 'active',
          changeIndex: null,
        });
      } else if (row.status === 'pending_remove') {
        await this.store.deleteById(row.id);
      }
    }
    this.logger.log(`recovery.change.settled user=${userId}`);
  }

  /**
   * Applies a settings change that was rejected or never executed: staged
   * additions disappear, staged removals return to service. Idempotent.
   */
  async abandon(userId: string, changeIndex: bigint): Promise<void> {
    for (const row of await this.rowsInChange(userId, changeIndex)) {
      if (row.status === 'pending_add') {
        await this.store.deleteById(row.id);
      } else if (row.status === 'pending_remove') {
        await this.store.updateById(row.id, {
          status: 'active',
          changeIndex: null,
        });
      }
    }
    this.logger.log(`recovery.change.abandoned user=${userId}`);
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
    return this.summarise(row, rows);
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

  private async insertEmailSigner(
    userId: string,
    email: string,
    status: RecoverySignerStatus,
  ): Promise<RecoverySignerRow> {
    const { address, sealed } = await this.mintSealedSigner();
    return this.store.insert({
      userId,
      address,
      channel: 'email',
      channelValue: email.toLowerCase(),
      sealedKey: sealed.ciphertext,
      sealedKeyId: sealed.keyId,
      status,
    });
  }

  private async rowsInChange(
    userId: string,
    changeIndex: bigint,
  ): Promise<RecoverySignerRow[]> {
    const index = changeIndex.toString();
    return (await this.store.findByUser(userId)).filter(
      (row) => row.changeIndex === index,
    );
  }

  private async assertRoomForAnother(
    userId: string,
  ): Promise<RecoverySignerRow[]> {
    const rows = await this.store.findByUser(userId);
    this.assertNoChangeInFlight(rows);

    // A pending removal still occupies a slot: it is in the signer set until
    // its change executes, and the program counts what is there, not what we
    // intend.
    if (rows.length >= MAX_RECOVERY_SIGNERS) {
      throw new RecoverySignerLimitError(
        `an Account may have at most ${MAX_RECOVERY_SIGNERS} recovery signers`,
      );
    }
    return rows;
  }

  /**
   * One settings change at a time.
   *
   * Changes are sequenced by the Settings `transactionIndex`, so a second one
   * proposed while the first is unexecuted would either collide on the index or
   * silently depend on the first landing.
   */
  private assertNoChangeInFlight(rows: RecoverySignerRow[]): void {
    if (rows.some((row) => row.changeIndex !== null)) {
      throw new RecoveryChangeInFlightError(
        'a recovery key change is already under way on this Account; finish or cancel it first',
      );
    }
  }

  private assertChannelUnused(
    rows: RecoverySignerRow[],
    channel: RecoveryChannel,
    channelValue: string,
  ): void {
    const clash = rows.find(
      (row) => row.channel === channel && row.channelValue === channelValue,
    );
    if (clash) {
      throw new DuplicateRecoveryChannelError(
        'that recovery channel is already on this Account',
      );
    }
  }

  private summarise(
    row: RecoverySignerRow,
    rows: RecoverySignerRow[],
  ): RecoverySignerSummary {
    return {
      id: row.id,
      address: row.address,
      channel: row.channel,
      channelValue: row.channelValue,
      createdAt: row.createdAt,
      status: row.status,
      removable: row.status === 'active' && backing(rows).length > 1,
    };
  }
}

/** The signers that are in the on-chain signer set right now. */
function backing(rows: RecoverySignerRow[]): RecoverySignerRow[] {
  return rows.filter(
    (row) => row.status === 'active' || row.status === 'pending_remove',
  );
}
