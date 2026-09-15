import { Inject, Injectable, Logger } from '@nestjs/common';
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/kit';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { randomBytes } from 'node:crypto';
import {
  RECOVERY_SIGNER_STORE,
  type RecoverySignerRow,
  type RecoverySignerStore,
} from './recovery-signer.store';
import {
  ContactEmailTakenError,
  ContactRecoverySignerError,
  DuplicateRecoveryChannelError,
  LastRecoverySignerError,
  RecoveryChangeInFlightError,
  RecoveryReleaseFrozenError,
  RecoverySignerLimitError,
  UnknownRecoverySignerError,
} from './recovery.errors';
import { AccountEventsService } from '../activity/account-events.service';
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
   * False when removing this signer would leave the Account with none, while
   * any change to it is still in flight, and always for the signer anchored
   * on the contact address, which is rotated rather than removed.
   */
  removable: boolean;
  /**
   * True for the signer anchored on the address on file. It is the one a lost
   * phone is recovered through, and rotating it is how the address moves.
   */
  isContactAddress: boolean;
}

/** What staging a contact address change produced: the new key and the one it retires. */
export interface ContactRotation {
  key: RecoverySignerSummary;
  retiring: RecoverySignerSummary;
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
 *
 * The contact address is not edited anywhere. It is whatever address anchors
 * S3, so it moves by rotating that signer: a settings change, two approvals,
 * the time lock, and only on execution does the address on file follow.
 */
@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    @Inject(RECOVERY_SIGNER_STORE) private readonly store: RecoverySignerStore,
    @Inject(RECOVERY_VAULT) private readonly vault: RecoveryVault,
    private readonly events: AccountEventsService,
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
    return this.summariseOne(userId, row);
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
      return this.summariseOne(userId, existing, rows);
    }

    return this.provisionEmailSigner(userId, email);
  }

  /**
   * Serialises a whole recovery key change for one Consumer: staging the
   * signer and claiming the Settings index it will occupy.
   *
   * The in-flight guard reads rows that the claim writes, so the two halves
   * have to run together or a second request can slip between them and claim
   * the same index.
   */
  withChangeLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return this.store.withUserLock(userId, fn);
  }

  async list(userId: string): Promise<RecoverySignerSummary[]> {
    const { rows, contact } = await this.load(userId);
    return rows.map((row) => this.summarise(row, rows, contact));
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
    return this.summariseOne(userId, row, [...rows, row]);
  }

  /**
   * Whether an address is free to become a recovery key on this Account.
   *
   * Checked before a code is sent rather than after: a duplicate refused at the
   * end costs the Consumer a mail they went and read for nothing.
   */
  async assertEmailUnused(userId: string, email: string): Promise<void> {
    const rows = await this.store.findByUser(userId);
    this.assertChannelUnused(rows, 'email', email.toLowerCase());
  }

  async addEmail(
    userId: string,
    email: string,
  ): Promise<RecoverySignerSummary> {
    const rows = await this.assertRoomForAnother(userId);
    this.assertChannelUnused(rows, 'email', email.toLowerCase());

    const row = await this.insertEmailSigner(userId, email, 'pending_add');
    this.logger.log(`recovery.signer.staged user=${userId} channel=email`);
    return this.summariseOne(userId, row, [...rows, row]);
  }

  /**
   * Whether an address may replace the one on file. Checked before the code
   * goes out, for the same reason `assertEmailUnused` is.
   *
   * Two things can stop it: it is already a recovery channel on this Account,
   * or it is another Consumer's contact address. The second is refused here
   * rather than a day later at execution, when the change has already been
   * approved twice and the signer set is mid-flight.
   */
  async assertContactEmailAvailable(
    userId: string,
    email: string,
  ): Promise<void> {
    const next = email.toLowerCase();
    const rows = await this.store.findByUser(userId);
    this.assertChannelUnused(rows, 'email', next);
    if (await this.store.isContactEmailTaken(userId, next)) {
      throw new ContactEmailTakenError(
        'that email is already on another account',
      );
    }
    // Two rotations racing to the same free address would both stage, both
    // execute on chain, and the second would hit the unique index at settle
    // with its change already final. Refused while the first is in flight.
    if (await this.store.isEmailClaimStaged(userId, next)) {
      throw new ContactEmailTakenError(
        'that email is being claimed by another account',
      );
    }
  }

  /**
   * Stages the change that moves the contact address.
   *
   * A fresh keypair sealed against the new address is staged for addition and
   * the signer anchored on the current address is staged for removal, in one
   * settings change. Fresh rather than the old secret re-addressed: the usual
   * reason to change the address is that the old inbox was compromised, and
   * an inbox that could ask us to sign with a key is an inbox that key has to
   * outlive.
   *
   * Nothing about the address on file moves here. It follows the signer when
   * the change executes, in `settle`, because staging is what an attacker
   * holding one stolen signer can do and executing is what they cannot.
   */
  async stageContactRotation(
    userId: string,
    email: string,
  ): Promise<ContactRotation> {
    const next = email.toLowerCase();
    const { rows, contact } = await this.load(userId);
    this.assertNoChangeInFlight(rows);

    const current = contact
      ? rows.find(
          (row) =>
            row.channel === 'email' &&
            row.channelValue === contact &&
            row.status === 'active',
        )
      : undefined;
    if (!current) {
      throw new UnknownRecoverySignerError(
        'this Account has no active recovery signer anchored on the address on file',
      );
    }
    if (current.channelValue === next) {
      throw new DuplicateRecoveryChannelError(
        'that is already the address on file',
      );
    }
    this.assertChannelUnused(rows, 'email', next);
    if (await this.store.isContactEmailTaken(userId, next)) {
      throw new ContactEmailTakenError(
        'that email is already on another account',
      );
    }
    // Two rotations racing to the same free address would both stage, both
    // execute on chain, and the second would hit the unique index at settle
    // with its change already final. Refused while the first is in flight.
    if (await this.store.isEmailClaimStaged(userId, next)) {
      throw new ContactEmailTakenError(
        'that email is being claimed by another account',
      );
    }

    // Not counted against the cap: the change adds one signer and removes
    // one, so the on-chain set is the same size after it as before.
    const replacement = await this.insertEmailSigner(
      userId,
      next,
      'pending_add',
    );
    const retiring = await this.store.updateById(current.id, {
      status: 'pending_remove',
    });

    this.logger.log(`recovery.contact.rotation_staged user=${userId}`);
    const all = [
      ...rows.filter((row) => row.id !== current.id),
      retiring,
      replacement,
    ];
    return {
      key: this.summarise(replacement, all, contact),
      retiring: this.summarise(retiring, all, contact),
    };
  }

  /**
   * Stages the removal of a recovery signer, refusing when it is the last one
   * or the one that anchors the contact address.
   *
   * The row is marked rather than deleted, and returns the address so the
   * caller can drive the settings change that takes it out of the on-chain
   * signer set. Deleting it here would leave the database claiming the Account
   * has fewer signers than the chain does, and the difference would only
   * surface when somebody tried to recover.
   */
  async remove(userId: string, signerId: string): Promise<{ address: string }> {
    const { rows, contact } = await this.load(userId);
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
    if (anchorsContact(target, contact)) {
      throw new ContactRecoverySignerError(
        'this key anchors the address on file; change the address rather than removing the key',
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

  /**
   * Remembers the transaction a step landed in.
   *
   * Overwritten by each step, which leaves the execute signature: Activity
   * names the transaction that actually put the key on chain, and that is the
   * last one submitted before the change reads as executed.
   */
  async markSignature(userId: string, signature: string): Promise<void> {
    for (const row of await this.store.findByUser(userId)) {
      if (row.changeIndex !== null) {
        await this.store.updateById(row.id, { changeSignature: signature });
      }
    }
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
   * Every signer a staged change carries: one for an add or a remove, two for
   * a rotation. What the change proposes is read off their statuses.
   */
  async stagedSigners(
    userId: string,
    changeIndex: bigint,
  ): Promise<RecoverySignerSummary[]> {
    const { rows, contact } = await this.load(userId);
    const index = changeIndex.toString();
    return rows
      .filter((row) => row.changeIndex === index)
      .map((row) => this.summarise(row, rows, contact));
  }

  /**
   * Applies a settings change that executed: staged additions become real, and
   * staged removals drop out. Idempotent, because the caller polls.
   */
  async settle(userId: string, changeIndex: bigint): Promise<void> {
    const rows = await this.rowsInChange(userId, changeIndex);
    if (rows.length === 0) return;

    // Before the rows, not after. A failure between the two then leaves the
    // rows still staged, and the next poll comes back through here.
    const rotation = await this.followContactRotation(userId, rows);
    if (rotation) {
      await this.events.recordContactEmailChanged(userId, {
        changeIndex,
        previousEmail: rotation.retiring.channelValue,
        nextEmail: rotation.replacement.channelValue,
        signature: rotation.replacement.changeSignature,
      });
    }
    // The two rows a rotation carries are one fact to the Consumer, told
    // above; announcing them as a key added and a key removed as well would
    // say the same thing three times.
    const rotated = new Set(
      rotation ? [rotation.retiring.id, rotation.replacement.id] : [],
    );

    for (const row of rows) {
      if (row.status === 'pending_add') {
        await this.store.updateById(row.id, {
          status: 'active',
          changeIndex: null,
          changeSignature: null,
        });
        // Recorded here rather than when the Consumer asked for it, because
        // this is the moment it became true: until the change executed the key
        // protected nothing.
        if (!rotated.has(row.id)) {
          await this.events.recordRecoveryKeyAdded(userId, {
            signerId: row.id,
            subject: row.channelValue,
            signature: row.changeSignature,
          });
        }
      } else if (row.status === 'pending_remove') {
        if (!rotated.has(row.id)) {
          await this.events.recordRecoveryKeyRemoved(userId, {
            signerId: row.id,
            subject: row.channelValue,
            signature: row.changeSignature,
          });
        }
        // After the event, because the row is the only place the subject
        // lives and deleting first would leave nothing to record.
        await this.store.deleteById(row.id);
      }
    }
    this.logger.log(`recovery.change.settled user=${userId}`);
  }

  /**
   * Applies a settings change that was rejected or never executed: staged
   * additions disappear, staged removals return to service. Idempotent.
   *
   * The address on file is untouched by construction: it only ever moves in
   * `settle`, so a rejected rotation leaves the entry point where it was.
   */
  async abandon(userId: string, changeIndex: bigint): Promise<void> {
    for (const row of await this.rowsInChange(userId, changeIndex)) {
      if (row.status === 'pending_add') {
        await this.store.deleteById(row.id);
      } else if (row.status === 'pending_remove') {
        await this.store.updateById(row.id, {
          status: 'active',
          changeIndex: null,
          changeSignature: null,
        });
      }
    }
    this.logger.log(`recovery.change.abandoned user=${userId}`);
  }

  /**
   * The signer in the on-chain set that a proved inbox may release.
   *
   * Looked up by the address the code went to rather than "the first sealed
   * signer", so the row that was proved and the key that signs are the same
   * row. An Account with two email recovery keys has two sealed keys, and a
   * code sent to one inbox must not open the other.
   */
  async signerAnchoredOn(
    userId: string,
    email: string,
  ): Promise<RecoverySignerSummary> {
    const { rows, contact } = await this.load(userId);
    const channelValue = email.toLowerCase();
    const row = rows.find(
      (candidate) =>
        candidate.channel === 'email' &&
        candidate.channelValue === channelValue &&
        inSignerSet(candidate),
    );
    if (!row) {
      throw new UnknownRecoverySignerError(
        'no recovery signer on this Account is anchored on that address',
      );
    }
    return this.summarise(row, rows, contact);
  }

  /**
   * Adds a recovery signer's approval to a transaction the caller built.
   *
   * The only place `RecoveryVault.open` is ever called, and the reason the
   * whole email-challenge apparatus exists. The opened key lives for the
   * length of this call: it signs, and the bytes are wiped rather than
   * returned, so no caller can hold S3 or use it for anything but the
   * transaction it passed in.
   *
   * Takes the signer by id so the row the inbox proved is the row that signs.
   * The caller is responsible for having proved that inbox first, and for
   * having built the transaction itself. Neither check belongs here: this
   * knows how to produce a signature, not when one is deserved. The one
   * refusal it does own is the release freeze, because that is about whether
   * we sign at all, not about who asked.
   */
  async approveWithRecoverySigner(
    userId: string,
    transaction: VersionedTransaction,
    signerId: string,
  ): Promise<VersionedTransaction> {
    await this.assertReleaseAllowed(userId);

    const signer = (await this.store.findByUser(userId)).find(
      (row) => row.id === signerId,
    );
    if (!signer || !inSignerSet(signer)) {
      throw new UnknownRecoverySignerError(
        `recovery signer ${signerId} is not in this Account's signer set`,
      );
    }
    if (!signer.sealedKey || !signer.sealedKeyId) {
      throw new UnknownRecoverySignerError(
        'we hold no key for that recovery signer',
      );
    }

    const seed = await this.vault.open({
      ciphertext: signer.sealedKey,
      keyId: signer.sealedKeyId,
      wrappedDataKey: signer.wrappedDataKey,
    });
    try {
      const keypair = Keypair.fromSeed(seed);
      // A mismatch means the row and the sealed key have drifted apart, and
      // signing anyway would produce a signature the program discards without
      // saying why.
      if (keypair.publicKey.toBase58() !== signer.address) {
        throw new UnknownRecoverySignerError(
          'the sealed key does not match the stored recovery address',
        );
      }
      transaction.sign([keypair]);
    } finally {
      seed.fill(0);
    }

    this.logger.log(`recovery.signer.approved user=${userId}`);
    return transaction;
  }

  /**
   * Refuses while support has the release frozen.
   *
   * Run wherever a sealed key is about to be asked for, and also before a
   * rotation that would need one is staged, so a Consumer is told at the
   * start rather than after an index has been burned.
   */
  async assertReleaseAllowed(userId: string): Promise<void> {
    if (await this.store.findReleaseFreeze(userId)) {
      throw new RecoveryReleaseFrozenError(
        'recovery through email is paused on this Account while a report is open; contact support',
      );
    }
  }

  releaseFreeze(userId: string): Promise<Date | null> {
    return this.store.findReleaseFreeze(userId);
  }

  /**
   * Stops every sealed recovery key we hold for this Consumer from signing.
   *
   * Refusal, not override. Nothing here can move an anchor or cancel a
   * change; it only withholds the one vote we hold. A Consumer with their
   * passkey and phone still has threshold and is unaffected.
   */
  async freezeRelease(userId: string, now = new Date()): Promise<void> {
    await this.store.setReleaseFreeze(userId, now);
    this.logger.warn(`recovery.release.frozen user=${userId}`);
  }

  async unfreezeRelease(userId: string): Promise<void> {
    await this.store.setReleaseFreeze(userId, null);
    this.logger.warn(`recovery.release.unfrozen user=${userId}`);
  }

  /**
   * Moves the address on file when the change that executed swapped the
   * signer anchored on it.
   *
   * Detected from the rows rather than flagged at staging: a change that
   * retires the contact signer and installs another email signer is a
   * contact rotation whatever it was called, and the entry point has to
   * follow the key or a lost phone would be recovered against an inbox
   * whose key is no longer in the signer set.
   */
  private async followContactRotation(
    userId: string,
    rows: RecoverySignerRow[],
  ): Promise<{
    retiring: RecoverySignerRow;
    replacement: RecoverySignerRow;
  } | null> {
    const contact = await this.store.findContactEmail(userId);
    const retiring = rows.find(
      (row) => row.status === 'pending_remove' && anchorsContact(row, contact),
    );
    const replacement = rows.find(
      (row) => row.status === 'pending_add' && row.channel === 'email',
    );
    if (!retiring || !replacement) return null;

    try {
      await this.store.updateContactEmail(userId, replacement.channelValue);
    } catch (err) {
      // The race the staging check narrows but cannot close: another account
      // claimed the address after this change was staged. The chain has
      // already moved, so this keeps failing on every poll; named here so the
      // stuck rotation is diagnosable rather than a bare constraint error.
      if ((err as { cause?: { code?: string } })?.cause?.code === '23505') {
        this.logger.error(
          `recovery.contact.conflict user=${userId} target=${replacement.channelValue}`,
        );
      }
      throw err;
    }
    this.logger.log(`recovery.contact.moved user=${userId}`);
    return { retiring, replacement };
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
      wrappedDataKey: sealed.wrappedDataKey ?? null,
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

  private async load(userId: string) {
    const [rows, contact] = await Promise.all([
      this.store.findByUser(userId),
      this.store.findContactEmail(userId),
    ]);
    return { rows, contact };
  }

  private async summariseOne(
    userId: string,
    row: RecoverySignerRow,
    rows?: RecoverySignerRow[],
  ): Promise<RecoverySignerSummary> {
    const contact = await this.store.findContactEmail(userId);
    return this.summarise(
      row,
      rows ?? (await this.store.findByUser(userId)),
      contact,
    );
  }

  private summarise(
    row: RecoverySignerRow,
    rows: RecoverySignerRow[],
    contact: string | null,
  ): RecoverySignerSummary {
    const isContactAddress = anchorsContact(row, contact);
    return {
      id: row.id,
      address: row.address,
      channel: row.channel,
      channelValue: row.channelValue,
      createdAt: row.createdAt,
      status: row.status,
      removable:
        row.status === 'active' &&
        !isContactAddress &&
        backing(rows).length > 1,
      isContactAddress,
    };
  }
}

/** The signers that are in the on-chain signer set right now. */
function backing(rows: RecoverySignerRow[]): RecoverySignerRow[] {
  return rows.filter(inSignerSet);
}

function inSignerSet(row: RecoverySignerRow): boolean {
  return row.status === 'active' || row.status === 'pending_remove';
}

function anchorsContact(
  row: RecoverySignerRow,
  contact: string | null,
): boolean {
  return (
    contact !== null && row.channel === 'email' && row.channelValue === contact
  );
}
