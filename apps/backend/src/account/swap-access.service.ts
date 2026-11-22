import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PublicKey,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  ABOVE_LIMIT_PROGRAM_ALLOWLIST,
  buildApproveSettingsChange,
  buildExecuteSettingsChange,
  buildUpdateAboveLimitAllowlist,
  deriveAccountAddresses,
  derivePolicyAddress,
  SETTINGS_TIME_LOCK_SECONDS,
} from '@prydd/smart-account';

import { AccountEventsService } from '../activity/account-events.service';
import {
  PREPARED_TX_STORE,
  PREPARED_TX_TTL_SECONDS,
} from '../prepared/prepared-tx.interface';
import type { PreparedTxStore } from '../prepared/prepared-tx.interface';
import { RecoveryService } from '../recovery/recovery.service';
import { AccountCreationError, SwapAccessError } from './account.errors';
import {
  ABOVE_LIMIT_POLICY_SEED,
  PROVISIONING_CHAIN,
  SQUADS_ACCOUNT_STORE,
} from './account.interface';
import type {
  ProposalState,
  ProvisioningChain,
  SquadsAccountRow,
  SquadsAccountStore,
} from './account.interface';

export type SwapAccessStep =
  /** Propose and both approvals in one transaction: one confirmation. */
  | 'stage'
  /** An approval the staging transaction did not carry. */
  | 'approve'
  | 'waiting'
  | 'execute';

export interface SwapAccessStatus {
  /**
   * `ready` when the Account can swap now, `off` when it needs the change this
   * service drives, `pending` while that change is in flight.
   */
  state: 'ready' | 'off' | 'pending';
  /** ISO-8601. When a pending change can land. Absent until it is approved. */
  executableAt?: string;
}

export interface SwapAccessPlan {
  done: boolean;
  step?: SwapAccessStep;
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

/** What the change is called wherever the Consumer is told about it. */
const SUBJECT = 'Swap';

/**
 * Turns Swap on for an Account that was set up before Swap existed.
 *
 * A swap runs under the above-limit policy, and a policy keeps the list of
 * programs it was created with. An Account provisioned before the swap
 * program joined that list has to have its policy rewritten, which is a
 * settings change: both of the Account's keys, then the 24 hour lock.
 *
 * The lock is not negotiable, and that is the point of it. Widening what the
 * two keys can do instantly is exactly what someone holding a stolen pair
 * would want, so it gets the same window to be noticed and rejected as a
 * change of signer.
 *
 * Propose and both approvals travel in one transaction, so the Consumer
 * confirms once. Every decision is re-read from the chain rather than stored,
 * so an interrupted change resumes where the chain says it is.
 */
@Injectable()
export class SwapAccessService {
  private readonly logger = new Logger(SwapAccessService.name);

  constructor(
    @Inject(SQUADS_ACCOUNT_STORE) private readonly store: SquadsAccountStore,
    @Inject(PROVISIONING_CHAIN) private readonly chain: ProvisioningChain,
    private readonly recovery: RecoveryService,
    private readonly events: AccountEventsService,
    @Inject(PREPARED_TX_STORE) private readonly prepared: PreparedTxStore,
  ) {}

  async status(userId: string): Promise<SwapAccessStatus> {
    const account = await this.requireAccount(userId);
    if (await this.isOn(account)) return { state: 'ready' };

    const index = account.pendingSwapAccessChangeIndex;
    if (!index) return { state: 'off' };

    const proposal = await this.chain.readProposal(
      account.settingsAddress,
      BigInt(index),
    );
    // Settled without turning Swap on: rejected, or overtaken. `next` clears
    // it; until then it is simply off.
    if (proposal?.settled) return { state: 'off' };
    const executableAt = proposal && this.executableAt(account, proposal);
    return {
      state: 'pending',
      ...(executableAt ? { executableAt: executableAt.toISOString() } : {}),
    };
  }

  /** Stages the change and returns the one transaction that carries it. */
  async start(userId: string): Promise<SwapAccessPlan> {
    // Reading the next index and staging against it are two statements; two
    // starts that cross in between would claim the same index.
    return this.store.withUserLock(userId, () => this.stage(userId));
  }

  private async stage(userId: string): Promise<SwapAccessPlan> {
    const account = await this.requireAccount(userId);
    if (await this.isOn(account)) {
      throw new SwapAccessError('Swap is already on for this Account');
    }
    await this.assertNothingElseInFlight(userId, account);

    const settings = await this.chain.readSettings(account.settingsAddress);
    const changeIndex = (settings.transactionIndex + 1n).toString();
    const instructions = this.build(account, changeIndex, 'stage');

    await this.store.updateByUserId(userId, {
      pendingSwapAccessChangeIndex: changeIndex,
    });
    // Announced at staging rather than when a watcher next sees it on chain:
    // the notice is the Consumer's warning that the delay has started.
    await this.events.recordSettingsChangeStaged(userId, {
      changeIndex,
      subject: SUBJECT,
      change: 'swap_access',
    });
    this.logger.log(
      `swap_access.started userId=${userId} index=${changeIndex}`,
    );
    return this.pin(userId, changeIndex, 'stage', instructions);
  }

  /**
   * The next step for the change in flight, or `done` when there is none.
   *
   * Also the reconciler: nothing else settles a staged change, so the app
   * calls this until it says done.
   */
  async next(userId: string): Promise<SwapAccessPlan> {
    const account = await this.requireAccount(userId);
    const changeIndex = account.pendingSwapAccessChangeIndex;
    if (!changeIndex) return { done: true };

    const proposal = await this.chain.readProposal(
      account.settingsAddress,
      BigInt(changeIndex),
    );

    if (!proposal) {
      const settings = await this.chain.readSettings(account.settingsAddress);
      if (BigInt(changeIndex) === settings.transactionIndex + 1n) {
        return this.prepare(userId, account, changeIndex, 'stage');
      }
      // The index moved on without this change, so it can never be proposed.
      await this.settle(userId, account, changeIndex, false);
      return { done: true };
    }

    if (proposal.settled) {
      // Only `Executed` means the chain took it: a fully approved change can
      // still be rejected inside the window.
      await this.settle(
        userId,
        account,
        changeIndex,
        proposal.status === 'Executed',
      );
      return { done: true };
    }

    if (missingApprovals(account, proposal).length > 0) {
      return this.prepare(userId, account, changeIndex, 'approve', proposal);
    }

    const executableAt = this.executableAt(account, proposal);
    if (executableAt && executableAt.getTime() > Date.now()) {
      return {
        done: false,
        step: 'waiting',
        changeIndex,
        executableAt: executableAt.toISOString(),
      };
    }

    return this.prepare(userId, account, changeIndex, 'execute');
  }

  async submit(userId: string, signedTxBase64: string): Promise<string> {
    await this.requireAccount(userId);
    await this.assertMatchesPreparedStep(userId, signedTxBase64);

    const signature = await this.chain.submit(signedTxBase64);
    await this.prepared.delete(preparedKey(userId));
    this.logger.log(
      `swap_access.step_landed userId=${userId} signature=${signature}`,
    );
    return signature;
  }

  private async settle(
    userId: string,
    account: SquadsAccountRow,
    changeIndex: string,
    executed: boolean,
  ): Promise<void> {
    if (executed) {
      // An executed proposal at an index proves some change landed there, not
      // that it was this one, so the policy is read back before saying so.
      if (!(await this.isOn(account))) {
        this.logger.error(
          `swap_access.not_applied userId=${userId} index=${changeIndex}`,
        );
        throw new AccountCreationError(
          'the executed change did not turn Swap on',
        );
      }
      await this.events.recordSettingsChangeExecuted(userId, {
        changeIndex,
        subject: SUBJECT,
      });
    } else {
      await this.events.recordSettingsChangeRejected(userId, {
        changeIndex,
        subject: SUBJECT,
      });
    }

    await this.store.updateByUserId(userId, {
      pendingSwapAccessChangeIndex: null,
    });
    await this.prepared.delete(preparedKey(userId));
    this.logger.log(
      `swap_access.settled userId=${userId} index=${changeIndex} executed=${executed}`,
    );
  }

  /** Whether the Account's policy already admits every program on the list. */
  private async isOn(account: SquadsAccountRow): Promise<boolean> {
    const allowed = await this.chain.readAllowedPrograms(
      account.settingsAddress,
      ABOVE_LIMIT_POLICY_SEED,
    );
    return ABOVE_LIMIT_PROGRAM_ALLOWLIST.every((program) =>
      allowed.some((admitted) => admitted.equals(program)),
    );
  }

  /**
   * Every settings change takes the next index, so a second one staged
   * alongside would claim it again and one of the two could never settle.
   */
  private async assertNothingElseInFlight(
    userId: string,
    account: SquadsAccountRow,
  ): Promise<void> {
    if (
      account.pendingApprovalChangeIndex ||
      account.pendingPrimaryChangeIndex ||
      account.pendingSpendingLimitChangeIndex ||
      (await this.recovery.pendingChange(userId))
    ) {
      throw new SwapAccessError(
        'another change to this Account is already in flight',
      );
    }
    if (account.pendingSwapAccessChangeIndex) {
      // Reconciled rather than refused outright: the common case is a change
      // the chain has already settled and nothing has cleared yet.
      const open = await this.next(userId);
      if (!open.done) {
        throw new SwapAccessError('Swap is already being turned on');
      }
    }
  }

  private async prepare(
    userId: string,
    account: SquadsAccountRow,
    changeIndex: string,
    step: SwapAccessStep,
    proposal?: ProposalState,
  ): Promise<SwapAccessPlan> {
    return this.pin(
      userId,
      changeIndex,
      step,
      this.build(account, changeIndex, step, proposal),
      step === 'approve' && proposal
        ? missingApprovals(account, proposal).includes(account.approvalSigner)
        : step === 'stage',
    );
  }

  private async pin(
    userId: string,
    changeIndex: string,
    step: SwapAccessStep,
    instructions: TransactionInstruction[],
    needsApprovalSignature = step === 'stage',
  ): Promise<SwapAccessPlan> {
    const unsigned = await this.chain.compile({ instructions });
    await this.prepared.set(
      preparedKey(userId),
      unsigned.messageBase64,
      PREPARED_TX_TTL_SECONDS,
    );
    this.logger.log(
      `swap_access.step userId=${userId} step=${step} index=${changeIndex}`,
    );
    return {
      done: false,
      step,
      ...unsigned,
      changeIndex,
      needsApprovalSignature,
    };
  }

  private build(
    account: SquadsAccountRow,
    changeIndex: string,
    step: SwapAccessStep,
    proposal?: ProposalState,
  ): TransactionInstruction[] {
    const addresses = deriveAccountAddresses(account.settingsSeed);
    const primary = new PublicKey(account.primarySigner);
    const approval = new PublicKey(account.approvalSigner);
    // The authority pays and never signs for the Account.
    const rentPayer = new PublicKey(this.chain.rentPayer);
    const transactionIndex = BigInt(changeIndex);
    const approve = (signer: PublicKey) =>
      buildApproveSettingsChange({ addresses, transactionIndex, signer });

    if (step === 'stage') {
      const { propose } = buildUpdateAboveLimitAllowlist({
        addresses,
        primary,
        approval,
        aboveLimitSeed: ABOVE_LIMIT_POLICY_SEED,
        proposer: primary,
        rentPayer,
        transactionIndex,
      });
      return [...propose, approve(primary), approve(approval)];
    }

    if (step === 'execute') {
      return [
        buildExecuteSettingsChange({
          addresses,
          transactionIndex,
          signer: primary,
          rentPayer,
          policies: [
            derivePolicyAddress(addresses.settings, ABOVE_LIMIT_POLICY_SEED),
          ],
        }),
      ];
    }

    return missingApprovals(account, proposal).map((signer) =>
      approve(new PublicKey(signer)),
    );
  }

  /**
   * When the change becomes executable, which is also the deadline for
   * rejecting it. The lock runs from the moment the quorum was reached.
   */
  private executableAt(
    account: SquadsAccountRow,
    proposal: ProposalState,
  ): Date | null {
    if (
      proposal.statusTimestamp === null ||
      missingApprovals(account, proposal).length > 0
    ) {
      return null;
    }
    return new Date(
      (Number(proposal.statusTimestamp) + SETTINGS_TIME_LOCK_SECONDS) * 1000,
    );
  }

  private async requireAccount(userId: string): Promise<SquadsAccountRow> {
    const account = await this.store.findByUserId(userId);
    if (!account) {
      throw new AccountCreationError('No Account exists for this Consumer');
    }
    return account;
  }

  private async assertMatchesPreparedStep(
    userId: string,
    signedTxBase64: string,
  ): Promise<void> {
    const expected = await this.prepared.get<string>(preparedKey(userId));
    if (!expected) {
      throw new AccountCreationError(
        'No Swap step is awaiting a signature for this Consumer',
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
        'signed transaction does not match the prepared Swap step',
      );
    }
  }
}

function missingApprovals(
  account: SquadsAccountRow,
  proposal?: ProposalState,
): string[] {
  const approved = proposal?.approved ?? [];
  return [account.primarySigner, account.approvalSigner].filter(
    (signer) => !approved.includes(signer),
  );
}

function preparedKey(userId: string): string {
  return `swap-access:${userId}`;
}
