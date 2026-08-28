import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PublicKey,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  buildApproveSettingsChange,
  buildExecuteSettingsChange,
  buildRotateApprovalSigner,
  deriveAccountAddresses,
  derivePolicyAddress,
  SETTINGS_TIME_LOCK_SECONDS,
} from '@xend/smart-account';

import { AccountEventsService } from '../activity/account-events.service';
import { RecoveryChallengeService } from '../recovery/recovery-challenge.service';
import { RecoveryService } from '../recovery/recovery.service';
import { NoRotationInFlightError } from '../recovery/recovery.errors';
import { TurnkeyService } from '../turnkey/turnkey.service';
import { AccountCreationError } from './account.errors';
import {
  ABOVE_LIMIT_POLICY_SEED,
  PROVISIONING_CHAIN,
  SQUADS_ACCOUNT_STORE,
} from './account.interface';
import type {
  ProvisioningChain,
  SquadsAccountRow,
  SquadsAccountStore,
} from './account.interface';

/**
 * The steps a device rotation passes through.
 *
 * `approve-recovery` never reaches the phone. It is the one approval the
 * backend can produce, and it is why the whole email challenge exists.
 */
export type DeviceRotationStep =
  | 'propose'
  | 'approve-primary'
  | 'approve-recovery'
  | 'waiting'
  | 'execute';

export interface DeviceRotationPlan {
  done: boolean;
  step?: DeviceRotationStep;
  unsignedTxBase64?: string;
  messageBase64?: string;
  blockhash?: string;
  lastValidBlockHeight?: number;
  changeIndex?: string;
  /** ISO-8601. Set only on `waiting`: when the time lock releases. */
  executableAt?: string;
  /** The approval signer this rotation is moving to. */
  newApprovalSigner?: string;
}

/**
 * Moves an Account's approval signer onto a new phone after the old one is gone.
 *
 * ## Why this is a recovery flow and not a settings screen
 *
 * S2's Turnkey sub-organization has exactly one authenticator, the hardware key
 * in the phone, and hardware keys are non-exportable. A lost phone therefore
 * takes S2 with it permanently, and the only way back is a new sub-org with a
 * new key and a settings change swapping one address for the other (D10c).
 *
 * That change needs two of three, and S2 is the one that is gone, so the pair
 * is S1 and S3. S1 is on the new phone behind the passkey. S3 is here, sealed,
 * and opening it is what the email code buys.
 *
 * ## Why the policy is rewritten in the same change
 *
 * The above-limit policy carries its own copy of the signer set. Rotating only
 * the Settings would leave a recovered Account able to make small Spends and
 * permanently unable to make large ones. `buildRotateApprovalSigner` carries
 * both halves, and the LiteSVM suite pins that the new key can spend above the
 * limit and the old one cannot.
 *
 * ## Why it still takes a day
 *
 * The Settings time lock (D3) applies to this like any other settings change.
 * That is deliberate: an inbox plus a passkey is exactly the pair this delay
 * exists to make visible, and the Consumer holding the old phone can reject it
 * inside the window. Recovery being slower than theft is the point.
 */
@Injectable()
export class DeviceRotationService {
  private readonly logger = new Logger(DeviceRotationService.name);

  /** Same guard as provisioning: the only bytes submitted are bytes we built. */
  private readonly prepared = new Map<string, string>();

  constructor(
    @Inject(SQUADS_ACCOUNT_STORE) private readonly store: SquadsAccountStore,
    @Inject(PROVISIONING_CHAIN) private readonly chain: ProvisioningChain,
    private readonly recovery: RecoveryService,
    private readonly challenges: RecoveryChallengeService,
    private readonly turnkey: TurnkeyService,
    private readonly events: AccountEventsService,
  ) {}

  /**
   * Enrols the new phone's hardware key and stages the swap.
   *
   * The sub-organization is created before the change is staged, for the same
   * reason enrolment does it in that order: a sub-org with no change staged is
   * an orphan the next attempt reuses, while a change staged against a sub-org
   * that does not exist is a proposal nobody can ever satisfy.
   */
  async start(
    userId: string,
    grantId: string,
    device: { hardwarePublicKey: string; security?: string },
  ): Promise<DeviceRotationPlan> {
    await this.challenges.assertGrant(userId, grantId, 'device_rotation');
    const account = await this.requireAccount(userId);

    const enrolled = await this.turnkey.ensureApprovalSigner({
      reference: userId,
      hardwarePublicKey: device.hardwarePublicKey,
      security: device.security,
    });

    if (enrolled.address === account.approvalSigner) {
      // This phone already holds S2. Nothing to recover, and proposing a swap
      // of a key for itself would burn an index and fail at execute.
      return { done: true };
    }

    if (account.pendingApprovalSigner === enrolled.address) {
      return this.planFrom(userId, grantId, true);
    }

    const settings = await this.chain.readSettings(account.settingsAddress);
    const changeIndex = settings.transactionIndex + 1n;

    // The staged row, not the one read before staging: the propose step is
    // built from the incoming signer, which only exists after this write.
    const staged = await this.store.updateByUserId(userId, {
      pendingApprovalSigner: enrolled.address,
      pendingApprovalSubOrgId: enrolled.subOrganizationId,
      pendingApprovalChangeIndex: changeIndex.toString(),
    });

    this.logger.log(
      `device_rotation.started userId=${userId} index=${changeIndex}`,
    );
    return this.prepare(userId, staged, 'propose', changeIndex);
  }

  /**
   * The next step, re-derived from the chain every time.
   *
   * Takes the grant because one of the steps it may perform is S3's approval,
   * which it produces inline rather than handing to the phone. A caller past
   * that point can pass an expired grant: the check only runs on the step that
   * needs it.
   */
  next(userId: string, grantId?: string): Promise<DeviceRotationPlan> {
    return this.planFrom(userId, grantId, true);
  }

  /**
   * `mayApprove` is what stops this sending S3's approval twice.
   *
   * The approval is produced here rather than on the phone, so the pass that
   * follows it has to re-read the chain to find out what to do next. An RPC
   * that has not caught up yet still reports the approval missing, and without
   * this the re-read would send another one, and another, for as long as the
   * lag lasted.
   */
  private async planFrom(
    userId: string,
    grantId: string | undefined,
    mayApprove: boolean,
  ): Promise<DeviceRotationPlan> {
    const account = await this.requireAccount(userId);
    const changeIndex = account.pendingApprovalChangeIndex
      ? BigInt(account.pendingApprovalChangeIndex)
      : null;
    if (changeIndex === null || !account.pendingApprovalSigner) {
      return { done: true };
    }

    const proposal = await this.chain.readProposal(
      account.settingsAddress,
      changeIndex,
    );
    if (!proposal) {
      return this.prepare(userId, account, 'propose', changeIndex);
    }

    if (proposal.settled) {
      await this.settle(account, proposal.status === 'Executed');
      this.prepared.delete(userId);
      return { done: true };
    }

    const approved = proposal.approved ?? [];
    if (!approved.includes(account.primarySigner)) {
      return this.prepare(userId, account, 'approve-primary', changeIndex);
    }

    const recoverySigner = await this.recoveryAddress(userId);
    if (!approved.includes(recoverySigner)) {
      if (!mayApprove) {
        // Sent, and the chain has not shown it yet. Reporting the step the
        // Consumer is on beats sending a second signature at an RPC that is
        // only behind.
        return {
          done: false,
          step: 'approve-recovery',
          changeIndex: changeIndex.toString(),
          newApprovalSigner: account.pendingApprovalSigner,
        };
      }
      if (!grantId) {
        throw new NoRotationInFlightError(
          'this step needs a verified recovery session',
        );
      }
      await this.approveAsRecovery(userId, grantId, account, changeIndex);
      return this.planFrom(userId, grantId, false);
    }

    const executableAt = this.executableAt(proposal.statusTimestamp);
    if (executableAt && executableAt.getTime() > Date.now()) {
      return {
        done: false,
        step: 'waiting',
        changeIndex: changeIndex.toString(),
        executableAt: executableAt.toISOString(),
        newApprovalSigner: account.pendingApprovalSigner ?? undefined,
      };
    }

    return this.prepare(userId, account, 'execute', changeIndex);
  }

  async submit(userId: string, signedTxBase64: string): Promise<string> {
    await this.requireAccount(userId);
    this.assertMatchesPreparedStep(userId, signedTxBase64);

    const signature = await this.chain.submit(signedTxBase64);
    this.prepared.delete(userId);
    this.logger.log(
      `device_rotation.step_landed userId=${userId} signature=${signature}`,
    );
    return signature;
  }

  /**
   * Produces S3's approval and sends it, without the phone.
   *
   * The grant is consumed after the transaction lands rather than before it is
   * built. A submit that fails on a stale blockhash would otherwise leave the
   * Consumer holding a code that no longer works, and the retry authorises
   * nothing new: the change it approves is already staged and pinned.
   */
  private async approveAsRecovery(
    userId: string,
    grantId: string,
    account: SquadsAccountRow,
    changeIndex: bigint,
  ): Promise<void> {
    await this.challenges.assertGrant(userId, grantId, 'device_rotation');

    const addresses = deriveAccountAddresses(account.settingsSeed);
    const recoverySigner = await this.recoveryAddress(userId);
    const compiled = await this.chain.compile({
      instructions: [
        buildApproveSettingsChange({
          addresses,
          transactionIndex: changeIndex,
          signer: new PublicKey(recoverySigner),
        }),
      ],
    });

    const transaction = await this.recovery.approveWithRecoverySigner(
      userId,
      VersionedTransaction.deserialize(
        Buffer.from(compiled.unsignedTxBase64, 'base64'),
      ),
    );

    const signature = await this.chain.submit(
      Buffer.from(transaction.serialize()).toString('base64'),
    );
    await this.challenges.consume(grantId);
    this.logger.log(
      `device_rotation.recovery_approved userId=${userId} signature=${signature}`,
    );
  }

  /**
   * Commits the swap, or forgets it.
   *
   * Only `Executed` moves the new signer into the Account's own columns. A
   * rejected change leaves the Consumer on the phone they had, which for a
   * genuinely lost phone means no S2 at all, and the row must say so rather
   * than name a key the chain never accepted.
   */
  private async settle(
    account: SquadsAccountRow,
    executed: boolean,
  ): Promise<void> {
    if (executed && account.pendingApprovalSigner) {
      await this.store.updateByUserId(account.userId, {
        approvalSigner: account.pendingApprovalSigner,
        approvalSubOrgId: account.pendingApprovalSubOrgId ?? undefined,
        pendingApprovalSigner: null,
        pendingApprovalSubOrgId: null,
        pendingApprovalChangeIndex: null,
      });
      await this.events.recordDeviceRotated(
        account.userId,
        account.pendingApprovalSigner,
      );
    } else {
      await this.store.updateByUserId(account.userId, {
        pendingApprovalSigner: null,
        pendingApprovalSubOrgId: null,
        pendingApprovalChangeIndex: null,
      });
    }

    this.logger.log(
      `device_rotation.settled userId=${account.userId} executed=${executed}`,
    );
  }

  private async prepare(
    userId: string,
    account: SquadsAccountRow,
    step: DeviceRotationStep,
    changeIndex: bigint,
  ): Promise<DeviceRotationPlan> {
    const { instructions, policies } = await this.build(
      account,
      step,
      changeIndex,
    );
    const unsigned = await this.chain.compile({ instructions });
    this.prepared.set(userId, unsigned.messageBase64);

    this.logger.log(
      `device_rotation.step userId=${userId} step=${step} index=${changeIndex} policies=${policies.length}`,
    );

    return {
      done: false,
      step,
      ...unsigned,
      changeIndex: changeIndex.toString(),
      newApprovalSigner: account.pendingApprovalSigner ?? undefined,
    };
  }

  private build(
    account: SquadsAccountRow,
    step: DeviceRotationStep,
    transactionIndex: bigint,
  ): Promise<{
    instructions: TransactionInstruction[];
    policies: PublicKey[];
  }> {
    const addresses = deriveAccountAddresses(account.settingsSeed);
    const primary = new PublicKey(account.primarySigner);
    const rentPayer = new PublicKey(this.chain.rentPayer);

    if (step === 'propose') {
      if (!account.pendingApprovalSigner) {
        throw new NoRotationInFlightError('no rotation is staged');
      }
      const { propose, policies } = buildRotateApprovalSigner({
        addresses,
        oldApproval: new PublicKey(account.approvalSigner),
        newApproval: new PublicKey(account.pendingApprovalSigner),
        primary,
        aboveLimitSeed: ABOVE_LIMIT_POLICY_SEED,
        proposer: primary,
        rentPayer,
        transactionIndex,
      });
      return Promise.resolve({ instructions: propose, policies });
    }

    if (step === 'execute') {
      // The policy the change rewrites rides along the way a created one does.
      const policies = [
        derivePolicyAddress(addresses.settings, ABOVE_LIMIT_POLICY_SEED),
      ];
      return Promise.resolve({
        instructions: [
          buildExecuteSettingsChange({
            addresses,
            transactionIndex,
            signer: primary,
            rentPayer,
            policies,
          }),
        ],
        policies,
      });
    }

    return Promise.resolve({
      instructions: [
        buildApproveSettingsChange({
          addresses,
          transactionIndex,
          signer: primary,
        }),
      ],
      policies: [],
    });
  }

  private async recoveryAddress(userId: string): Promise<string> {
    const signers = await this.recovery.list(userId);
    const active = signers.find(
      (signer) => signer.status === 'active' && signer.channel === 'email',
    );
    if (!active) {
      throw new NoRotationInFlightError(
        'this Account has no active email recovery signer',
      );
    }
    return active.address;
  }

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
        'No rotation step is awaiting a signature for this Consumer',
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
        'signed transaction does not match the prepared rotation step',
      );
    }
  }
}
