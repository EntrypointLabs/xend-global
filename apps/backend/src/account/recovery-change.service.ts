import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PublicKey,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  buildAddRecoverySigner,
  buildApproveSettingsChange,
  buildExecuteSettingsChange,
  buildRemoveRecoverySigner,
  buildRotateRecoverySigner,
  deriveAccountAddresses,
  SETTINGS_TIME_LOCK_SECONDS,
} from '@xend/smart-account';

import { AccountEventsService } from '../activity/account-events.service';
import { RecoveryService } from '../recovery/recovery.service';
import { AccountCreationError } from './account.errors';
import { PROVISIONING_CHAIN, SQUADS_ACCOUNT_STORE } from './account.interface';
import type {
  ProvisioningChain,
  SquadsAccountRow,
  SquadsAccountStore,
} from './account.interface';

/**
 * The steps a recovery key change passes through on the device.
 *
 * The same four as provisioning, plus `waiting`. Provisioning never waits
 * because it runs at a zero time lock and raises the lock last; every change
 * after that one meets the lock head on.
 */
export type RecoveryChangeStep =
  | 'propose'
  | 'approve-primary'
  | 'approve-approval'
  | 'waiting'
  | 'execute';

export interface RecoveryChangePlan {
  done: boolean;
  step?: RecoveryChangeStep;
  unsignedTxBase64?: string;
  messageBase64?: string;
  blockhash?: string;
  lastValidBlockHeight?: number;
  /** The Settings `transactionIndex` this change occupies. */
  changeIndex?: string;
  /** ISO-8601. Set only on `waiting`: when the time lock releases. */
  executableAt?: string;
  needsApprovalSignature?: boolean;
}

/**
 * Drives the settings change that adds, removes or rotates a recovery key.
 *
 * Provisioning's shape with a different payload, and for the same reason: the
 * two approvals are S1 and S2, both of which live on the phone, so the backend
 * can only prepare bytes and take them back signed. It holds S3, which is
 * deliberately not one of the two. That is also what makes a contact address
 * change safe to run through here: the inbox being replaced never votes.
 *
 * Every decision is re-read from the chain rather than stored, so an
 * interrupted change resumes and a client that lies about where it is gets
 * corrected.
 */
@Injectable()
export class RecoveryChangeService {
  private readonly logger = new Logger(RecoveryChangeService.name);

  /**
   * The message each Consumer was last asked to sign, by user id.
   *
   * Same guard as provisioning: the authority partially signs whatever arrives
   * at `submit`, so the only bytes it will ever sign are bytes this service
   * built. In memory, so a restart just means preparing again.
   */
  private readonly prepared = new Map<string, string>();

  constructor(
    @Inject(SQUADS_ACCOUNT_STORE) private readonly store: SquadsAccountStore,
    @Inject(PROVISIONING_CHAIN) private readonly chain: ProvisioningChain,
    private readonly recovery: RecoveryService,
    private readonly events: AccountEventsService,
  ) {}

  /**
   * The next step for the change in flight, or `done` when there is none.
   *
   * Also the reconciler: a change the chain has executed settles the staged
   * rows, and one it has rejected abandons them. Nothing else moves a row out
   * of a pending state, so this has to be called until it says done.
   */
  async next(userId: string): Promise<RecoveryChangePlan> {
    const account = await this.requireAccount(userId);
    const open = await this.recovery.pendingChange(userId);
    if (!open) return { done: true };

    const proposal = await this.chain.readProposal(
      account.settingsAddress,
      open.changeIndex,
    );

    if (!proposal) {
      // Staged here but never proposed on chain, so the propose step is still
      // outstanding.
      return this.prepare(userId, account, 'propose', open.changeIndex);
    }

    if (proposal.settled) {
      // Only `Executed` means the chain took the change. Approval count cannot
      // stand in for it: the whole point of the time lock is that a fully
      // approved change can still be rejected inside the window, and treating
      // that as executed would mark a recovery key active that never reached
      // the signer set.
      const executed = proposal.status === 'Executed';
      // Read before settling: settling a removal deletes the row, and the
      // outcome is recorded against the key it was about.
      const subject = await this.channelValueOf(userId, open.signerId);
      if (executed) {
        await this.recovery.settle(userId, open.changeIndex);
        await this.events.recordSettingsChangeExecuted(userId, {
          changeIndex: open.changeIndex,
          subject,
        });
      } else {
        await this.recovery.abandon(userId, open.changeIndex);
        await this.events.recordSettingsChangeRejected(userId, {
          changeIndex: open.changeIndex,
          subject,
        });
      }
      this.prepared.delete(userId);
      this.logger.log(
        `recovery_change.settled userId=${userId} index=${open.changeIndex} executed=${executed}`,
      );
      return { done: true };
    }

    const approved = proposal.approved ?? [];
    if (!approved.includes(account.primarySigner)) {
      return this.prepare(userId, account, 'approve-primary', open.changeIndex);
    }
    if (!approved.includes(account.approvalSigner)) {
      return this.prepare(
        userId,
        account,
        'approve-approval',
        open.changeIndex,
      );
    }

    const executableAt = this.executableAt(proposal.statusTimestamp);
    if (executableAt && executableAt.getTime() > Date.now()) {
      return {
        done: false,
        step: 'waiting',
        changeIndex: open.changeIndex.toString(),
        executableAt: executableAt.toISOString(),
      };
    }

    return this.prepare(userId, account, 'execute', open.changeIndex);
  }

  /**
   * Stages a change and returns its first step.
   *
   * The rows are written before the chain is touched, so a failure between
   * the two leaves staged rows with a `changeIndex` that `next` will find and
   * re-propose rather than rows nobody remembers. A rotation carries two: the
   * key coming in and the one going out share the index.
   */
  async start(
    userId: string,
    ...signerIds: string[]
  ): Promise<RecoveryChangePlan> {
    const account = await this.requireAccount(userId);
    const settings = await this.chain.readSettings(account.settingsAddress);
    const changeIndex = settings.transactionIndex + 1n;

    for (const signerId of signerIds) {
      await this.recovery.markChange(signerId, changeIndex);
    }
    // Announced here, at the moment of staging, rather than when the watcher
    // next sees it on chain: the notice is the Consumer's only warning that
    // the delay has started, and it cannot depend on a poll or on the app.
    // A rotation carries two rows, the incoming one first, and the incoming
    // one is what the notice is about.
    await this.events.recordSettingsChangeStaged(userId, {
      changeIndex,
      subject: await this.channelValueOf(userId, signerIds[0]),
      change: signerIds.length > 1 ? 'contact_email' : 'recovery_key',
    });
    this.logger.log(
      `recovery_change.started userId=${userId} index=${changeIndex}`,
    );
    return this.prepare(userId, account, 'propose', changeIndex);
  }

  async submit(userId: string, signedTxBase64: string): Promise<string> {
    await this.requireAccount(userId);
    this.assertMatchesPreparedStep(userId, signedTxBase64);

    const signature = await this.chain.submit(signedTxBase64);
    this.prepared.delete(userId);
    // Kept against the staged row so Activity can name the transaction that
    // landed the key. Each step overwrites it, leaving the execute signature.
    await this.recovery.markSignature(userId, signature);
    this.logger.log(
      `recovery_change.step_landed userId=${userId} signature=${signature}`,
    );
    return signature;
  }

  private async prepare(
    userId: string,
    account: SquadsAccountRow,
    step: RecoveryChangeStep,
    changeIndex: bigint,
  ): Promise<RecoveryChangePlan> {
    const instructions = await this.build(userId, account, step, changeIndex);
    const unsigned = await this.chain.compile({ instructions });
    this.prepared.set(userId, unsigned.messageBase64);

    this.logger.log(
      `recovery_change.step userId=${userId} step=${step} index=${changeIndex}`,
    );

    return {
      done: false,
      step,
      ...unsigned,
      changeIndex: changeIndex.toString(),
      needsApprovalSignature: step === 'approve-approval',
    };
  }

  private async build(
    userId: string,
    account: SquadsAccountRow,
    step: RecoveryChangeStep,
    transactionIndex: bigint,
  ): Promise<TransactionInstruction[]> {
    const addresses = deriveAccountAddresses(account.settingsSeed);
    const primary = new PublicKey(account.primarySigner);
    // S1 proposes because it is the only role whose permissions carry
    // `Initiate`. The authority pays and never signs.
    const rentPayer = new PublicKey(this.chain.rentPayer);

    if (step === 'propose') {
      const staged = await this.recovery.stagedSigners(
        userId,
        transactionIndex,
      );
      const [incoming] = staged.filter((s) => s.status === 'pending_add');
      const [outgoing] = staged.filter((s) => s.status === 'pending_remove');
      const params = {
        addresses,
        proposer: primary,
        rentPayer,
        transactionIndex,
      };
      if (incoming && outgoing) {
        return buildRotateRecoverySigner({
          ...params,
          oldSigner: new PublicKey(outgoing.address),
          newSigner: new PublicKey(incoming.address),
        });
      }
      if (incoming) {
        return buildAddRecoverySigner({
          ...params,
          newSigner: new PublicKey(incoming.address),
        });
      }
      if (outgoing) {
        return buildRemoveRecoverySigner({
          ...params,
          oldSigner: new PublicKey(outgoing.address),
        });
      }
      throw new AccountCreationError(
        'no recovery key change is staged for this Consumer',
      );
    }

    if (step === 'execute') {
      return [
        buildExecuteSettingsChange({
          addresses,
          transactionIndex,
          signer: primary,
          rentPayer,
        }),
      ];
    }

    return [
      buildApproveSettingsChange({
        addresses,
        transactionIndex,
        signer:
          step === 'approve-primary'
            ? primary
            : new PublicKey(account.approvalSigner),
      }),
    ];
  }

  private async channelValueOf(
    userId: string,
    signerId: string,
  ): Promise<string | null> {
    const signer = (await this.recovery.list(userId)).find(
      (candidate) => candidate.id === signerId,
    );
    return signer?.channelValue ?? null;
  }

  /**
   * When the change becomes executable, which is also the deadline for
   * rejecting it.
   *
   * The lock runs from the moment the quorum was reached, not from when the
   * change was proposed, so an unapproved change has no deadline yet.
   */
  private executableAt(statusTimestamp: bigint | null): Date | null {
    if (statusTimestamp === null) return null;
    return new Date(
      (Number(statusTimestamp) + SETTINGS_TIME_LOCK_SECONDS) * 1000,
    );
  }

  private async requireAccount(userId: string): Promise<SquadsAccountRow> {
    const account = await this.store.findByUserId(userId);
    if (!account) {
      throw new AccountCreationError('No Account exists for this Consumer');
    }
    return account;
  }

  private assertMatchesPreparedStep(userId: string, signedTxBase64: string) {
    const expected = this.prepared.get(userId);
    if (!expected) {
      throw new AccountCreationError(
        'No recovery key step is awaiting a signature for this Consumer',
      );
    }

    let submitted: string;
    try {
      submitted = Buffer.from(
        VersionedTransaction.deserialize(
          Buffer.from(signedTxBase64, 'base64'),
        ).message.serialize(),
      ).toString('base64');
    } catch {
      throw new AccountCreationError(
        'signedTxBase64 is not a valid transaction',
      );
    }

    if (submitted !== expected) {
      throw new AccountCreationError(
        'signed transaction does not match the prepared recovery key step',
      );
    }
  }
}
