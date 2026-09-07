import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PublicKey,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  buildApproveSettingsChange,
  buildCreateSpendingLimitPolicy,
  buildExecuteSettingsChange,
  buildRemoveSpendingLimit,
  buildUpdateSpendingLimit,
  deriveAccountAddresses,
  derivePolicyAddress,
  nextPolicySeed,
  SettingsChangeRefusedError,
  SETTINGS_TIME_LOCK_SECONDS,
  type LimitPeriod,
  type SpendingLimit,
} from '@xend/smart-account';

import { AccountEventsService } from '../activity/account-events.service';
import {
  PREPARED_TX_STORE,
  PREPARED_TX_TTL_SECONDS,
} from '../prepared/prepared-tx.interface';
import type { PreparedTxStore } from '../prepared/prepared-tx.interface';
import { RecoveryService } from '../recovery/recovery.service';
import {
  AccountCreationError,
  SpendingLimitChangeError,
} from './account.errors';
import {
  PROVISIONING_CHAIN,
  spendingLimitSeed,
  SQUADS_ACCOUNT_STORE,
} from './account.interface';
import type {
  ProvisioningChain,
  SquadsAccountRow,
  SquadsAccountStore,
} from './account.interface';
import { describeSpendingLimit } from './spending-limit.terms';

/** The steps a Spending Limit change passes through on the device. */
export type SpendingLimitChangeStep =
  | 'propose'
  | 'approve-primary'
  | 'approve-approval'
  | 'waiting'
  | 'execute';

export interface SpendingLimitChangeRequest {
  /**
   * The new cap for the period, in the mint's smallest units. Absent removes
   * the limit instead.
   */
  maxPerPeriod?: string;
  remove?: boolean;
}

export interface SpendingLimitChangePlan {
  done: boolean;
  step?: SpendingLimitChangeStep;
  unsignedTxBase64?: string;
  messageBase64?: string;
  blockhash?: string;
  lastValidBlockHeight?: number;
  /** The Settings `transactionIndex` this change occupies. */
  changeIndex?: string;
  /** ISO-8601. Set only on `waiting`: when the time lock releases. */
  executableAt?: string;
  needsApprovalSignature?: boolean;
  /** True while the change in flight takes the limit off the Account. */
  removing?: boolean;
  /** True while it puts one back on an Account that has none. */
  creating?: boolean;
  /** The limit the change installs, in the Consumer's own terms. */
  limit?: string;
}

/**
 * What the Consumer asked for, held for as long as the change can still be
 * walked.
 *
 * Only the propose step needs it: every later step is an approval or an
 * execute against an index, and the actions are already fixed on chain by
 * then. It also carries what the limit was, because the outcome is recorded
 * against the change and by then the old terms are gone.
 */
interface StagedChange {
  changeIndex: string;
  /** Null removes the limit. Otherwise the new cap, in the mint's units. */
  maxPerPeriod: string | null;
  /**
   * The Account has no limit, so the change creates the policy rather than
   * rewriting it. Fixed when the change is staged: the policy only appears
   * when this very change lands, so it cannot become false underneath.
   */
  creating: boolean;
  /**
   * The seed the policy sits at, as a decimal string. On a creation it is the
   * seed the program will assign, which is only written to the Account once
   * the chain confirms the policy is there.
   */
  policySeed: string;
  /** Carried forward from the limit being replaced, or the default on a create. */
  period: LimitPeriod;
  previous: string | null;
}

/** What a limit created from the app is denominated in and how often it refills. */
const CREATED_LIMIT_PERIOD: LimitPeriod = 'Daily';

/**
 * Longer than the time lock, because the change is staged on one day and
 * executed on the next. Anything shorter would forget a change halfway
 * through its own delay, and the Consumer would be left with an on-chain
 * proposal nothing here could finish.
 */
const STAGED_TTL_SECONDS = SETTINGS_TIME_LOCK_SECONDS * 2;

/**
 * Drives the settings change that raises, lowers or removes the Spending Limit.
 *
 * The Spending Limit is the size of the band one signature can move, so
 * changing it runs through the Account's own threshold and its 24 hour lock
 * exactly like a signer change does. A limit a single signature could raise
 * would not be a limit.
 *
 * Provisioning's shape with a different payload. The two approvals are S1 and
 * S2, both on the phone, so the backend can only prepare bytes and take them
 * back signed; it holds S3, which is deliberately not one of the two.
 *
 * Every decision is re-read from the chain rather than stored, so an
 * interrupted change resumes and a client that lies about where it is gets
 * corrected.
 */
@Injectable()
export class SpendingLimitChangeService {
  private readonly logger = new Logger(SpendingLimitChangeService.name);

  constructor(
    @Inject(SQUADS_ACCOUNT_STORE) private readonly store: SquadsAccountStore,
    @Inject(PROVISIONING_CHAIN) private readonly chain: ProvisioningChain,
    private readonly recovery: RecoveryService,
    private readonly events: AccountEventsService,
    private readonly config: ConfigService,
    /**
     * The message each Consumer was last asked to sign, and what they asked
     * for. Same guard as provisioning on the first: the authority partially
     * signs whatever arrives at `submit`, so the only bytes it will ever sign
     * are bytes this built.
     */
    @Inject(PREPARED_TX_STORE) private readonly prepared: PreparedTxStore,
  ) {}

  /**
   * Stages the change and returns its first step.
   *
   * The change is built before it is announced. A change the package refuses,
   * such as terms the Account already carries, must not leave a Consumer
   * holding a notice saying something started.
   */
  async start(
    userId: string,
    request: SpendingLimitChangeRequest,
  ): Promise<SpendingLimitChangePlan> {
    const account = await this.requireAccount(userId);
    await this.assertNothingElseInFlight(userId, account);

    const settings = await this.chain.readSettings(account.settingsAddress);
    const changeIndex = settings.transactionIndex + 1n;
    const current = await this.currentLimit(account);
    if (request.remove && !current) {
      throw new SpendingLimitChangeError(
        'this Account has no Spending Limit to remove',
      );
    }
    const staged: StagedChange = {
      changeIndex: changeIndex.toString(),
      maxPerPeriod: request.remove ? null : (request.maxPerPeriod ?? null),
      creating: !current,
      // A created policy takes the seed the program is about to assign, not
      // the one the Account used to read: seeds only move forward, and a
      // removed one is never handed back.
      policySeed: current
        ? spendingLimitSeed(account).toString()
        : nextPolicySeed(settings).toString(),
      period: current?.period ?? CREATED_LIMIT_PERIOD,
      previous: current
        ? describeSpendingLimit(current.maxPerPeriod, current.period)
        : null,
    };
    if (!request.remove && staged.maxPerPeriod === null) {
      throw new SpendingLimitChangeError(
        'a Spending Limit change carries either a new amount or a removal',
      );
    }

    const instructions = await this.build(account, staged, 'propose');
    await this.prepared.set(stagedKey(userId), staged, STAGED_TTL_SECONDS);
    // Announced at the moment of staging rather than when a watcher next sees
    // it on chain: the notice is the Consumer's only warning that the delay
    // has started, and it cannot depend on a poll or on the app being open.
    await this.events.recordSettingsChangeStaged(userId, {
      changeIndex,
      subject: limitOf(staged),
      change: 'spending_limit',
    });
    this.logger.log(
      `spending_limit_change.started userId=${userId} index=${changeIndex} removing=${staged.maxPerPeriod === null} creating=${staged.creating}`,
    );
    return this.pin(userId, staged, 'propose', instructions);
  }

  /**
   * The next step for the change in flight, or `done` when there is none.
   *
   * Also the reconciler: a change the chain has executed is committed against
   * what the policy actually holds, and one it has rejected is forgotten.
   * Nothing else settles a staged change, so this has to be called until it
   * says done.
   */
  async next(userId: string): Promise<SpendingLimitChangePlan> {
    const account = await this.requireAccount(userId);
    const staged = await this.prepared.get<StagedChange>(stagedKey(userId));
    if (!staged) return { done: true };

    const changeIndex = BigInt(staged.changeIndex);
    const proposal = await this.chain.readProposal(
      account.settingsAddress,
      changeIndex,
    );

    if (!proposal) {
      if (await this.isNextIndex(account, changeIndex)) {
        // Staged here but never proposed on chain, so propose is outstanding.
        return this.prepare(userId, account, staged, 'propose');
      }
      // The index has moved on without this change, so it can never be
      // proposed. Leaving it staged would block every later change forever.
      await this.settle(userId, staged, false);
      return { done: true };
    }

    if (proposal.settled) {
      // Only `Executed` means the chain took the change. Approvals cannot
      // stand in for it: the whole point of the lock is that a fully approved
      // change can still be rejected inside the window.
      await this.settle(userId, staged, proposal.status === 'Executed');
      return { done: true };
    }

    const approved = proposal.approved ?? [];
    if (!approved.includes(account.primarySigner)) {
      return this.prepare(userId, account, staged, 'approve-primary');
    }
    if (!approved.includes(account.approvalSigner)) {
      return this.prepare(userId, account, staged, 'approve-approval');
    }

    const executableAt = this.executableAt(proposal.statusTimestamp);
    if (executableAt && executableAt.getTime() > Date.now()) {
      return {
        done: false,
        step: 'waiting',
        changeIndex: staged.changeIndex,
        executableAt: executableAt.toISOString(),
        removing: staged.maxPerPeriod === null,
        creating: staged.creating,
        limit: limitOf(staged),
      };
    }

    return this.prepare(userId, account, staged, 'execute');
  }

  async submit(userId: string, signedTxBase64: string): Promise<string> {
    await this.requireAccount(userId);
    await this.assertMatchesPreparedStep(userId, signedTxBase64);

    const signature = await this.chain.submit(signedTxBase64);
    await this.prepared.delete(preparedKey(userId));
    this.logger.log(
      `spending_limit_change.step_landed userId=${userId} signature=${signature}`,
    );
    return signature;
  }

  /**
   * Commits the change, or forgets it.
   *
   * An executed proposal at an index proves that some change landed there, not
   * that it was this one. What the policy actually holds is read back before
   * anything is written down, so a committed row can never name a limit the
   * chain never took.
   */
  private async settle(
    userId: string,
    staged: StagedChange,
    executed: boolean,
  ): Promise<void> {
    if (executed) {
      await this.assertLanded(userId, staged);
      if (staged.creating) {
        // Written here and nowhere earlier. A column naming a policy the chain
        // never created would point every later read at an empty address, and
        // the Account would look as though it had no limit while carrying one.
        await this.store.updateByUserId(userId, {
          spendingLimitPolicySeed: BigInt(staged.policySeed),
        });
      }
      await this.events.recordSpendingLimitChanged(userId, {
        changeIndex: staged.changeIndex,
        limit: limitOf(staged),
        previous: staged.previous,
      });
      await this.events.recordSettingsChangeExecuted(userId, {
        changeIndex: staged.changeIndex,
        subject: limitOf(staged),
      });
    } else {
      await this.events.recordSettingsChangeRejected(userId, {
        changeIndex: staged.changeIndex,
        subject: limitOf(staged),
      });
    }

    await this.prepared.delete(stagedKey(userId));
    await this.prepared.delete(preparedKey(userId));
    this.logger.log(
      `spending_limit_change.settled userId=${userId} index=${staged.changeIndex} executed=${executed}`,
    );
  }

  private async assertLanded(
    userId: string,
    staged: StagedChange,
  ): Promise<void> {
    const account = await this.requireAccount(userId);
    // The seed the change wrote to, which on a creation is not yet the one the
    // Account resolves to.
    const seed = BigInt(staged.policySeed);

    if (staged.maxPerPeriod === null) {
      if (await this.chain.policyExists(account.settingsAddress, seed)) {
        this.logger.error(
          `spending_limit_change.policy_still_present userId=${userId} index=${staged.changeIndex}`,
        );
        throw new AccountCreationError(
          'the executed change did not remove the Spending Limit',
        );
      }
      return;
    }

    const limit = await this.limitAt(account.settingsAddress, seed);
    if (!limit || limit.maxPerPeriod.toString() !== staged.maxPerPeriod) {
      this.logger.error(
        `spending_limit_change.limit_mismatch userId=${userId} index=${staged.changeIndex}`,
      );
      throw new AccountCreationError(
        'the executed change did not install the staged Spending Limit',
      );
    }
  }

  /**
   * A change staged elsewhere holds the next index, so staging here would
   * claim it again and whichever landed second would be settled as if it were
   * the first.
   */
  private async assertNothingElseInFlight(
    userId: string,
    account: SquadsAccountRow,
  ): Promise<void> {
    if (
      account.pendingApprovalChangeIndex ||
      account.pendingPrimaryChangeIndex
    ) {
      throw new SpendingLimitChangeError(
        'another change to this Account is already in flight',
      );
    }
    if (await this.recovery.pendingChange(userId)) {
      throw new SpendingLimitChangeError(
        'another change to this Account is already in flight',
      );
    }
    if (await this.prepared.get<StagedChange>(stagedKey(userId))) {
      // Reconciled rather than refused outright: the common case is a change
      // the chain has already settled and nothing has cleared yet.
      const open = await this.next(userId);
      if (!open.done) {
        throw new SpendingLimitChangeError(
          'a Spending Limit change is already in flight; finish or reject it first',
        );
      }
    }
  }

  private async prepare(
    userId: string,
    account: SquadsAccountRow,
    staged: StagedChange,
    step: SpendingLimitChangeStep,
  ): Promise<SpendingLimitChangePlan> {
    return this.pin(
      userId,
      staged,
      step,
      await this.build(account, staged, step),
    );
  }

  private async pin(
    userId: string,
    staged: StagedChange,
    step: SpendingLimitChangeStep,
    instructions: TransactionInstruction[],
  ): Promise<SpendingLimitChangePlan> {
    const unsigned = await this.chain.compile({ instructions });
    await this.prepared.set(
      preparedKey(userId),
      unsigned.messageBase64,
      PREPARED_TX_TTL_SECONDS,
    );

    this.logger.log(
      `spending_limit_change.step userId=${userId} step=${step} index=${staged.changeIndex}`,
    );

    return {
      done: false,
      step,
      ...unsigned,
      changeIndex: staged.changeIndex,
      needsApprovalSignature: step === 'approve-approval',
      removing: staged.maxPerPeriod === null,
      creating: staged.creating,
      limit: limitOf(staged),
    };
  }

  private async build(
    account: SquadsAccountRow,
    staged: StagedChange,
    step: SpendingLimitChangeStep,
  ): Promise<TransactionInstruction[]> {
    const addresses = deriveAccountAddresses(account.settingsSeed);
    const primary = new PublicKey(account.primarySigner);
    // S1 proposes because it is the only role whose permissions carry
    // `Initiate`. The authority pays and never signs.
    const rentPayer = new PublicKey(this.chain.rentPayer);
    const transactionIndex = BigInt(staged.changeIndex);

    if (step === 'propose') {
      try {
        return await this.proposeChange(account, staged, {
          addresses,
          primary,
          rentPayer,
          transactionIndex,
        });
      } catch (cause) {
        if (cause instanceof SettingsChangeRefusedError) {
          throw new SpendingLimitChangeError(cause.message);
        }
        throw cause;
      }
    }

    if (step === 'execute') {
      // The policy this change creates, rewrites or removes rides along as a
      // remaining account, which is where a creation is charged its rent.
      return [
        buildExecuteSettingsChange({
          addresses,
          transactionIndex,
          signer: primary,
          rentPayer,
          policies: [
            derivePolicyAddress(addresses.settings, BigInt(staged.policySeed)),
          ],
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

  /**
   * The three shapes a Spending Limit change takes.
   *
   * Which one is settled by whether the Account has a limit at all, not by
   * what the client asked for. An Account that removed its limit has no policy
   * to rewrite, and a `PolicyUpdate` against an address holding nothing is
   * refused a day later at execute, having spent an index and the whole wait.
   */
  private async proposeChange(
    account: SquadsAccountRow,
    staged: StagedChange,
    common: {
      addresses: ReturnType<typeof deriveAccountAddresses>;
      primary: PublicKey;
      rentPayer: PublicKey;
      transactionIndex: bigint;
    },
  ): Promise<TransactionInstruction[]> {
    const { addresses, primary, rentPayer, transactionIndex } = common;

    if (staged.creating) {
      const maxPerPeriod = this.stagedAmount(staged);
      return buildCreateSpendingLimitPolicy({
        addresses,
        policySeed: BigInt(staged.policySeed),
        terms: {
          mint: new PublicKey(
            this.config.getOrThrow<string>('EXPO_PUBLIC_USDC_MINT_ADDRESS'),
          ),
          maxPerUse: maxPerPeriod,
          maxPerPeriod,
          period: staged.period,
          // Any destination, for the reason provisioning gives: the limit is
          // about value per period, not about who is paid.
          destinations: [],
        },
        limitSigner: primary,
        proposer: primary,
        rentPayer,
        transactionIndex,
      }).propose;
    }

    const seed = spendingLimitSeed(account);
    const [settings, currentLimit] = await Promise.all([
      this.chain.readSettings(account.settingsAddress),
      this.chain.readSpendingLimit(account.settingsAddress, seed),
    ]);
    const shared = {
      addresses,
      spendingLimitSeed: seed,
      currentLimit,
      signers: settings.signers,
      proposer: primary,
      rentPayer,
      transactionIndex,
    };

    if (staged.maxPerPeriod === null) {
      return buildRemoveSpendingLimit(shared).propose;
    }

    const maxPerPeriod = this.stagedAmount(staged);
    return buildUpdateSpendingLimit({
      ...shared,
      // Per-use tracks per-period, which is the shape the Account was
      // provisioned with: the ceiling is on the period, and a finer per-use
      // cap would turn one ordinary Spend into two signatures.
      terms: {
        mint: currentLimit.mint,
        maxPerUse: maxPerPeriod,
        maxPerPeriod,
        period: currentLimit.period,
        destinations: currentLimit.destinations,
      },
      limitSigner: primary,
    }).propose;
  }

  private stagedAmount(staged: StagedChange): bigint {
    if (staged.maxPerPeriod === null) {
      throw new SpendingLimitChangeError(
        'a Spending Limit change carries either a new amount or a removal',
      );
    }
    return BigInt(staged.maxPerPeriod);
  }

  /** Null when the Account has no limit, which is a state it can be set from. */
  private currentLimit(
    account: SquadsAccountRow,
  ): Promise<SpendingLimit | null> {
    return this.limitAt(account.settingsAddress, spendingLimitSeed(account));
  }

  private async limitAt(
    settingsAddress: string,
    policySeed: bigint,
  ): Promise<SpendingLimit | null> {
    const exists = await this.chain.policyExists(settingsAddress, policySeed);
    return exists
      ? this.chain.readSpendingLimit(settingsAddress, policySeed)
      : null;
  }

  /** Whether the staged index is still the one the next proposal would take. */
  private async isNextIndex(
    account: SquadsAccountRow,
    changeIndex: bigint,
  ): Promise<boolean> {
    const settings = await this.chain.readSettings(account.settingsAddress);
    return changeIndex === settings.transactionIndex + 1n;
  }

  /**
   * When the change becomes executable, which is also the deadline for
   * rejecting it. The lock runs from the moment the quorum was reached, so an
   * unapproved change has no deadline yet.
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

  private async assertMatchesPreparedStep(
    userId: string,
    signedTxBase64: string,
  ): Promise<void> {
    const expected = await this.prepared.get<string>(preparedKey(userId));
    if (!expected) {
      throw new AccountCreationError(
        'No Spending Limit step is awaiting a signature for this Consumer',
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
        'signed transaction does not match the prepared Spending Limit step',
      );
    }
  }
}

/** What the change installs, in the words the Consumer is shown. */
function limitOf(staged: StagedChange): string {
  return staged.maxPerPeriod === null
    ? 'no limit, so every Spend needs a second confirmation'
    : describeSpendingLimit(BigInt(staged.maxPerPeriod), staged.period);
}

function preparedKey(userId: string): string {
  return `spending-limit-change:${userId}`;
}

function stagedKey(userId: string): string {
  return `spending-limit-change:staged:${userId}`;
}
