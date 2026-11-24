import { Inject, Injectable, Logger } from '@nestjs/common';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import {
  buildRejectSettingsChange,
  deriveAccountAddresses,
  SETTINGS_TIME_LOCK_SECONDS,
} from '@prydd/smart-account';

import { AccountEventsService } from '../activity/account-events.service';
import type { StagedChangeKind } from '../notifications/security-notice.service';
import {
  PREPARED_TX_STORE,
  PREPARED_TX_TTL_SECONDS,
} from '../prepared/prepared-tx.interface';
import type { PreparedTxStore } from '../prepared/prepared-tx.interface';
import { RecoveryService } from '../recovery/recovery.service';
import { AccountCreationError } from './account.errors';
import {
  ABOVE_LIMIT_POLICY_SEED,
  PROVISIONING_CHAIN,
  spendingLimitSeed,
  SQUADS_ACCOUNT_STORE,
} from './account.interface';
import type {
  ProvisioningChain,
  SquadsAccountRow,
  SquadsAccountStore,
} from './account.interface';

/**
 * A settings change staged against a Consumer's Account, and the way out of it.
 *
 * The Settings time lock is the whole defence against a stolen quorum: two
 * signers can agree a change, but it cannot execute until the lock elapses, and
 * in that window any signer can reject it. That is only a defence if the
 * Consumer finds out, so a staged change is announced, and rejecting it is one
 * tap rather than a support ticket.
 *
 * Provisioning's own change is deliberately not announced. The Consumer is
 * driving that one in the foreground, has just approved it themselves, and
 * telling them their account is under attack while they set it up would teach
 * them to dismiss exactly the notice that matters later.
 */
export interface StagedChange {
  transactionIndex: string;
  status: string;
  /** Base58 signers that have approved it so far. */
  approvals: string[];
  /**
   * ISO-8601, or null while the change is not approved yet.
   *
   * When it becomes executable, and so the deadline for rejecting it. Null
   * means the quorum has not been reached, which is not the same as safe: the
   * clock starts the moment it is.
   */
  executableAt: string | null;
  /**
   * True when this Consumer started the change from their own app.
   *
   * The test is whether the backend holds a staged recovery key row carrying
   * this index, which it only does for a change proposed through its own
   * endpoint with S1 on the device.
   *
   * Reported rather than filtered, because the client is the right place to
   * decide. A stolen phone can stage a change through the same endpoint and
   * would be flagged self-initiated here, so the flag softens the announcement
   * rather than suppressing it.
   */
  selfInitiated: boolean;
  /**
   * Which of the backend's own flows staged this, or null when none did.
   *
   * Several changes can wait at once, and the app has to tell them apart: a
   * Swap change waiting is no reason to hold back a new Spending Limit. Null
   * is the one that matters most, a change that reached the chain without
   * passing through here.
   */
  kind: StagedChangeKind | null;
}

/**
 * How far back a first look goes. Everything behind it was settled or
 * cancelled long before, on any Account that has not been driven to stage
 * this many changes without landing one.
 */
const SCAN_LIMIT = 40n;

@Injectable()
export class AccountChangeService {
  private readonly logger = new Logger(AccountChangeService.name);
  /**
   * Per Settings address, the index every change up to which has settled.
   * Only a saving on reads: losing it on restart costs one longer look.
   */
  private readonly settledThrough = new Map<string, bigint>();

  constructor(
    @Inject(SQUADS_ACCOUNT_STORE) private readonly store: SquadsAccountStore,
    @Inject(PROVISIONING_CHAIN) private readonly chain: ProvisioningChain,
    private readonly recovery: RecoveryService,
    private readonly events: AccountEventsService,
    /**
     * The rejection each Consumer was last handed.
     *
     * Same reason as provisioning: the authority partially signs whatever
     * arrives at submit, so the bytes have to be pinned to what was prepared
     * or the endpoint becomes a way to have the backend sign anything.
     *
     * The index rides along because once the rejection lands the proposal is
     * settled and no longer readable as pending, and the outcome is recorded
     * against the change it decided.
     */
    @Inject(PREPARED_TX_STORE) private readonly prepared: PreparedTxStore,
  ) {}

  /** Every change awaiting execution on this Consumer's Account, oldest first. */
  async pending(userId: string): Promise<StagedChange[]> {
    const account = await this.store.findByUserId(userId);
    if (!account) return [];
    return this.pendingFor(account);
  }

  /**
   * Reads every index that can still land, not only the newest.
   *
   * Several changes may wait at once, and the newest is the one a Consumer
   * just made. Looking only there would let a change nobody here staged sit
   * unannounced behind it for its whole time lock.
   */
  async pendingFor(account: SquadsAccountRow): Promise<StagedChange[]> {
    const settings = await this.chain.readSettings(account.settingsAddress);

    // Before provisioning finishes, the only change in flight is the one the
    // Consumer is making.
    if (!(await this.isProvisioned(account, settings.timeLockSeconds))) {
      return [];
    }

    const top = settings.transactionIndex;
    // A signer change cancels everything at or below the stale index without
    // touching the proposals, so those still read as open and are not.
    let floor = settings.staleTransactionIndex ?? 0n;
    const settled = this.settledThrough.get(account.settingsAddress) ?? 0n;
    if (settled > floor) floor = settled;
    const capped = top - floor > SCAN_LIMIT;
    if (capped) floor = top - SCAN_LIMIT;

    const kinds = await this.knownKinds(account);
    const waiting: StagedChange[] = [];
    let unbroken = !capped;
    let settledThrough = floor;

    for (let index = floor + 1n; index <= top; index += 1n) {
      const proposal = await this.chain.readProposal(
        account.settingsAddress,
        index,
      );
      if (proposal?.settled) {
        if (unbroken) settledThrough = index;
        continue;
      }
      // A missing proposal is not a settled one: the transaction can exist
      // without it and be given one later, so the next look reads it again.
      unbroken = false;
      if (!proposal) continue;

      const kind = kinds.get(index.toString()) ?? null;
      waiting.push({
        transactionIndex: index.toString(),
        status: proposal.status,
        approvals: proposal.approved,
        selfInitiated: kind !== null,
        kind,
        executableAt:
          proposal.status === 'Approved' && proposal.statusTimestamp !== null
            ? new Date(
                Number(
                  proposal.statusTimestamp + BigInt(SETTINGS_TIME_LOCK_SECONDS),
                ) * 1000,
              ).toISOString()
            : null,
      });
    }

    // Settled is final, so the next look starts after the last index every
    // earlier one has reached it.
    if (settledThrough > settled) {
      this.settledThrough.set(account.settingsAddress, settledThrough);
    }
    return waiting;
  }

  /** The indexes the backend's own flows staged, and what each one is. */
  private async knownKinds(
    account: SquadsAccountRow,
  ): Promise<Map<string, StagedChangeKind>> {
    const kinds = new Map<string, StagedChangeKind>();
    const note = (index: string | null | undefined, kind: StagedChangeKind) => {
      if (index) kinds.set(index, kind);
    };
    note(account.pendingSpendingLimitChangeIndex, 'spending_limit');
    note(account.pendingSwapAccessChangeIndex, 'swap_access');
    note(account.pendingApprovalChangeIndex, 'device');
    note(account.pendingPrimaryChangeIndex, 'passkey');
    const open = await this.recovery.pendingChange(account.userId);
    if (open) kinds.set(open.changeIndex.toString(), 'recovery_key');
    return kinds;
  }

  /**
   * Builds the rejection for the Consumer to sign with S2 and then S1.
   *
   * Both, because one is not a refusal. At a threshold of 2 of 3 a single
   * rejection is recorded and the change stays open, so a one-signature
   * rejection reports success and stops nothing. Proven against the deployed
   * program in the smart-account package.
   *
   * That makes rejecting cost a biometric prompt, which an earlier version of
   * this avoided on the grounds that refusing should be the cheapest action in
   * the flow. It is the right instinct and the wrong trade: an action that is
   * cheap and ineffective is worse for the Consumer than one that works and
   * asks for a fingerprint.
   */
  async prepareRejection(
    userId: string,
    /** Which waiting change to reject. Required once more than one waits. */
    index?: string,
  ): Promise<{
    unsignedTxBase64: string;
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    const account = await this.store.findByUserId(userId);
    if (!account) {
      throw new AccountCreationError('No Account exists for this Consumer');
    }

    const waiting = await this.pendingFor(account);
    if (waiting.length === 0) {
      throw new AccountCreationError(
        'No settings change is awaiting a decision',
      );
    }
    if (index === undefined && waiting.length > 1) {
      // Guessing here would reject a change the Consumer did not point at.
      throw new AccountCreationError(
        'More than one change is waiting; say which one to reject',
      );
    }
    const staged =
      index === undefined
        ? waiting[0]
        : waiting.find((change) => change.transactionIndex === index);
    if (!staged) {
      throw new AccountCreationError('That change is no longer waiting');
    }

    const addresses = deriveAccountAddresses(account.settingsSeed);
    const transactionIndex = BigInt(staged.transactionIndex);
    // Read again rather than carried on the staged change, which is the shape
    // the app renders: who has voted is only ever needed here, and widening
    // that response would publish the Account's voting record to build one
    // transaction.
    const proposal = await this.chain.readProposal(
      account.settingsAddress,
      transactionIndex,
    );
    const alreadyRejected = proposal?.rejected ?? [];
    // Whoever has not voted yet. A signer who already rejected cannot reject
    // again, and including them fails the whole transaction, which is how a
    // half-finished rejection would otherwise become permanently unfinishable.
    // S2 leads so Turnkey evaluates a payload carrying every slot it will end
    // up with.
    const instructions = [account.approvalSigner, account.primarySigner]
      .filter((signer) => !alreadyRejected.includes(signer))
      .map((signer) =>
        buildRejectSettingsChange({
          addresses,
          transactionIndex,
          signer: new PublicKey(signer),
        }),
      );

    if (instructions.length === 0) {
      throw new AccountCreationError(
        'Both on-device signers have already rejected this change',
      );
    }

    const unsigned = await this.chain.compile({ instructions });
    await this.prepared.set<PreparedRejection>(
      preparedKey(userId),
      {
        messageBase64: unsigned.messageBase64,
        transactionIndex: staged.transactionIndex,
      },
      PREPARED_TX_TTL_SECONDS,
    );

    this.logger.log(
      `account_change.reject_prepared userId=${userId} index=${staged.transactionIndex}`,
    );

    return {
      unsignedTxBase64: unsigned.unsignedTxBase64,
      blockhash: unsigned.blockhash,
      lastValidBlockHeight: unsigned.lastValidBlockHeight,
    };
  }

  async submitRejection(
    userId: string,
    signedTxBase64: string,
  ): Promise<string> {
    const expected = await this.prepared.get<PreparedRejection>(
      preparedKey(userId),
    );
    if (!expected) {
      throw new AccountCreationError(
        'No rejection is awaiting a signature for this Consumer',
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
    if (submitted !== expected.messageBase64) {
      throw new AccountCreationError(
        'signed transaction does not match the prepared rejection',
      );
    }

    let signature: string;
    try {
      signature = await this.chain.submit(signedTxBase64);
    } catch (cause) {
      // The caller is told nothing beyond "it failed", so the reason has to
      // land here or it is lost. The common one is a signer who already voted:
      // the program refuses the replay, and without this line the log shows a
      // prepare with no outcome at all.
      this.logger.error(
        `account_change.reject_failed userId=${userId} reason=${describe(cause)}`,
      );
      throw cause;
    }
    await this.prepared.delete(preparedKey(userId));

    // A rejected change never reaches the signer set, so a recovery key row
    // staged against it has to go back. Leaving it would show the Consumer a
    // key that is pending forever and block the next change on the in-flight
    // guard. Only the row for this change: another may be waiting beside it.
    const open = await this.recovery.pendingChange(userId);
    if (open && open.changeIndex.toString() === expected.transactionIndex) {
      await this.recovery.abandon(userId, open.changeIndex);
    }

    await this.events.recordSettingsChangeRejected(userId, {
      changeIndex: expected.transactionIndex,
      signature,
    });

    this.logger.log(
      `account_change.rejected userId=${userId} signature=${signature}`,
    );
    return signature;
  }

  private async isProvisioned(
    account: SquadsAccountRow,
    timeLockSeconds: number,
  ): Promise<boolean> {
    if (timeLockSeconds === 0) return false;
    return (
      (await this.chain.policyExists(
        account.settingsAddress,
        spendingLimitSeed(account),
      )) &&
      (await this.chain.policyExists(
        account.settingsAddress,
        ABOVE_LIMIT_POLICY_SEED,
      ))
    );
  }
}

interface PreparedRejection {
  messageBase64: string;
  transactionIndex: string;
}

function preparedKey(userId: string): string {
  return `account-change:${userId}`;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
