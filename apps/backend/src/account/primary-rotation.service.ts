import { Inject, Injectable, Logger } from '@nestjs/common';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { eq } from 'drizzle-orm';
import type { TransactionInstruction } from '@solana/web3.js';
import {
  buildApproveSettingsChange,
  buildExecuteSettingsChange,
  buildRotatePrimarySigner,
  deriveAccountAddresses,
  derivePolicyAddress,
  SETTINGS_TIME_LOCK_SECONDS,
} from '@xend/smart-account';

import { AccountEventsService } from '../activity/account-events.service';
import { DbService } from '../db/db.service';
import { smartAccounts } from '../db/schema';
import {
  PREPARED_TX_STORE,
  PREPARED_TX_TTL_SECONDS,
} from '../prepared/prepared-tx.interface';
import type { PreparedTxStore } from '../prepared/prepared-tx.interface';
import { RecoveryChallengeService } from '../recovery/recovery-challenge.service';
import { RecoveryService } from '../recovery/recovery.service';
import { NoRotationInFlightError } from '../recovery/recovery.errors';
import { SOLANA_RPC } from '../solana/solana-rpc.interface';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import { WALLET_PROVIDER } from '../wallet/wallet-provider.interface';
import type { WalletProvider } from '../wallet/wallet-provider.interface';
import { AccountCreationError, PasskeyInUseError } from './account.errors';
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

export type PrimaryRotationStep =
  | 'propose'
  | 'approve-approval'
  | 'approve-recovery'
  | 'waiting'
  | 'execute';

export interface PrimaryRotationPlan {
  done: boolean;
  step?: PrimaryRotationStep;
  unsignedTxBase64?: string;
  messageBase64?: string;
  blockhash?: string;
  lastValidBlockHeight?: number;
  changeIndex?: string;
  /** Every device-signed step here is the approval signer's to sign. */
  needsApprovalSignature?: boolean;
  /** ISO-8601. Set only on `waiting`: when the time lock releases. */
  executableAt?: string;
  /** The primary signer this rotation is moving to. */
  newPrimarySigner?: string;
}

/**
 * Replaces the Account's primary signer after its passkey is gone.
 *
 * ## Why this is the mirror image of a device rotation
 *
 * A passkey deleted from the platform's password manager is as unrecoverable
 * as a hardware key in a lost phone. The pair meeting the threshold is
 * therefore the Device Key on this phone and the recovery signer in the
 * vault: the approval signer proposes, approves and executes, which is what
 * its Initiate grant exists for, and the emailed code buys S3's vote. The
 * old primary never participates.
 *
 * ## Why both policies ride in the change
 *
 * The primary sits on both spend paths. The spending-limit policy names it
 * alone, the above-limit policy names it beside the approval signer, and each
 * carries its own inline copy of the signer set. A rotation that touched only
 * the Settings would leave every Spend unsignable forever.
 *
 * ## What the fresh passkey is
 *
 * A new credential means a new wallet-provider user and a new embedded
 * wallet, and the wallet's address is the incoming signer. It is read off a
 * verified identity token rather than the request body, and the binding that
 * makes that passkey open this Account moves only when the change executes.
 */
@Injectable()
export class PrimaryRotationService {
  private readonly logger = new Logger(PrimaryRotationService.name);

  constructor(
    @Inject(SQUADS_ACCOUNT_STORE) private readonly store: SquadsAccountStore,
    @Inject(PROVISIONING_CHAIN) private readonly chain: ProvisioningChain,
    @Inject(WALLET_PROVIDER) private readonly wallet: WalletProvider,
    private readonly recovery: RecoveryService,
    private readonly challenges: RecoveryChallengeService,
    private readonly events: AccountEventsService,
    private readonly db: DbService,
    @Inject(SOLANA_RPC) private readonly solana: SolanaRpc,
    /** Same guard as provisioning: the only bytes submitted are bytes we built. */
    @Inject(PREPARED_TX_STORE) private readonly prepared: PreparedTxStore,
  ) {}

  /**
   * Verifies the fresh passkey's identity and stages the swap.
   *
   * The identity token is the only trusted source of the incoming signer: it
   * proves the caller actually holds a session for that wallet-provider user,
   * where an address in the body could name anybody's wallet.
   */
  async start(
    userId: string,
    grantId: string,
    privyIdToken: string,
  ): Promise<PrimaryRotationPlan> {
    await this.challenges.assertGrant(userId, grantId, 'primary_rotation');
    await this.recovery.assertReleaseAllowed(userId);

    const incoming = await this.wallet.verifyIdToken(privyIdToken);

    return this.store.withUserLock(userId, () =>
      this.stage(userId, grantId, {
        signer: incoming.walletAddress,
        providerId: incoming.providerUserId,
      }),
    );
  }

  private async stage(
    userId: string,
    grantId: string,
    incoming: { signer: string; providerId: string },
  ): Promise<PrimaryRotationPlan> {
    let account = await this.requireAccount(userId);

    if (incoming.signer === account.primarySigner) {
      // The passkey they just used is the one already on the Account. Nothing
      // was lost, and proposing a swap of a key for itself would burn an
      // index and fail at execute.
      return { done: true };
    }

    // A credential can only ever open the account it is bound to, so one
    // bound elsewhere must be refused before it is staged into this signer
    // set: executing would hand two accounts to one identity and break both
    // bindings.
    const [bound] = await this.db.client
      .select({ userId: smartAccounts.userId })
      .from(smartAccounts)
      .where(eq(smartAccounts.providerUserId, incoming.providerId))
      .limit(1);
    if (bound && bound.userId !== userId) {
      throw new PasskeyInUseError(
        'that passkey already belongs to another account',
      );
    }

    if (
      account.pendingApprovalChangeIndex ||
      account.pendingSpendingLimitChangeIndex
    ) {
      // Every settings change races the same index, and the two rotations
      // write the same signer set on top of that.
      throw new AccountCreationError(
        'another change to this Account is already in flight',
      );
    }

    if (account.pendingPrimarySigner === incoming.signer) {
      return this.planFrom(userId, grantId, true);
    }

    if (account.pendingPrimaryChangeIndex) {
      // The proposal on chain still carries the earlier passkey. Overwriting
      // the staged columns here would let that proposal execute and then be
      // recorded as if it had installed this one, binding a credential the
      // signer set never accepted.
      account = await this.settleOrRefuse(userId, account);
    }

    const settings = await this.chain.readSettings(account.settingsAddress);
    const changeIndex = settings.transactionIndex + 1n;

    const staged = await this.store.updateByUserId(userId, {
      pendingPrimarySigner: incoming.signer,
      pendingPrimaryProviderId: incoming.providerId,
      pendingPrimaryChangeIndex: changeIndex.toString(),
    });

    // The phone that can refuse this is the one holding the Device Key, and
    // it is also the one that has to hear about it: an inbox is enough to
    // start this, and the delay only protects somebody who is told it began.
    await this.events.recordSettingsChangeStaged(userId, {
      changeIndex,
      subject: incoming.signer,
      change: 'passkey',
    });

    this.logger.log(
      `primary_rotation.started userId=${userId} index=${changeIndex}`,
    );
    return this.prepare(userId, staged, 'propose', changeIndex);
  }

  next(userId: string, grantId?: string): Promise<PrimaryRotationPlan> {
    return this.planFrom(userId, grantId, true);
  }

  /** Mirrors DeviceRotationService.planFrom, including the mayApprove guard. */
  private async planFrom(
    userId: string,
    grantId: string | undefined,
    mayApprove: boolean,
  ): Promise<PrimaryRotationPlan> {
    const account = await this.requireAccount(userId);
    const changeIndex = account.pendingPrimaryChangeIndex
      ? BigInt(account.pendingPrimaryChangeIndex)
      : null;
    if (changeIndex === null || !account.pendingPrimarySigner) {
      return { done: true };
    }

    const proposal = await this.chain.readProposal(
      account.settingsAddress,
      changeIndex,
    );
    if (!proposal) {
      if (await this.isNextIndex(account, changeIndex)) {
        return this.prepare(userId, account, 'propose', changeIndex);
      }
      await this.resolveWithoutProposal(account, changeIndex);
      await this.prepared.delete(preparedKey(userId));
      return { done: true };
    }

    if (proposal.settled) {
      await this.settle(account, proposal.status === 'Executed');
      await this.prepared.delete(preparedKey(userId));
      return { done: true };
    }

    const approved = proposal.approved ?? [];
    if (!approved.includes(account.approvalSigner)) {
      return this.prepare(userId, account, 'approve-approval', changeIndex);
    }

    const held = await this.heldRecoveryAddresses(userId);
    if (!held.some((address) => approved.includes(address))) {
      if (!mayApprove) {
        return {
          done: false,
          step: 'approve-recovery',
          changeIndex: changeIndex.toString(),
          newPrimarySigner: account.pendingPrimarySigner,
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
        newPrimarySigner: account.pendingPrimarySigner ?? undefined,
      };
    }

    return this.prepare(userId, account, 'execute', changeIndex);
  }

  async submit(userId: string, signedTxBase64: string): Promise<string> {
    await this.requireAccount(userId);
    await this.assertMatchesPreparedStep(userId, signedTxBase64);

    const signature = await this.chain.submit(signedTxBase64);
    await this.prepared.delete(preparedKey(userId));
    this.logger.log(
      `primary_rotation.step_landed userId=${userId} signature=${signature}`,
    );
    return signature;
  }

  /** Mirrors DeviceRotationService.settleOrRefuse. */
  private async settleOrRefuse(
    userId: string,
    account: SquadsAccountRow,
  ): Promise<SquadsAccountRow> {
    const changeIndex = BigInt(account.pendingPrimaryChangeIndex as string);
    const inFlight = new AccountCreationError(
      'a passkey replacement is already in flight; finish or reject it first',
    );

    const proposal = await this.chain.readProposal(
      account.settingsAddress,
      changeIndex,
    );
    if (proposal) {
      if (!proposal.settled) throw inFlight;
      await this.settle(account, proposal.status === 'Executed');
    } else if (await this.isNextIndex(account, changeIndex)) {
      throw inFlight;
    } else {
      await this.resolveWithoutProposal(account, changeIndex);
    }
    await this.prepared.delete(preparedKey(userId));
    return this.requireAccount(userId);
  }

  private async isNextIndex(
    account: SquadsAccountRow,
    changeIndex: bigint,
  ): Promise<boolean> {
    const settings = await this.chain.readSettings(account.settingsAddress);
    return changeIndex === settings.transactionIndex + 1n;
  }

  /** Mirrors DeviceRotationService.resolveWithoutProposal. */
  private async resolveWithoutProposal(
    account: SquadsAccountRow,
    changeIndex: bigint,
  ): Promise<void> {
    if (await this.rotationLanded(account)) {
      await this.commit(account);
      return;
    }
    await this.store.updateByUserId(account.userId, {
      pendingPrimarySigner: null,
      pendingPrimaryProviderId: null,
      pendingPrimaryChangeIndex: null,
    });
    await this.events.recordSettingsChangeRejected(account.userId, {
      changeIndex,
      subject: account.pendingPrimarySigner,
    });
    this.logger.warn(
      `primary_rotation.stale_index_cleared userId=${account.userId} index=${changeIndex}`,
    );
  }

  private async rotationLanded(account: SquadsAccountRow): Promise<boolean> {
    if (!account.pendingPrimarySigner) return false;
    const signers = (
      await this.chain.readSettings(account.settingsAddress)
    ).signers.map((signer) => signer.key.toBase58());
    return (
      signers.includes(account.pendingPrimarySigner) &&
      !signers.includes(account.primarySigner)
    );
  }

  private async approveAsRecovery(
    userId: string,
    grantId: string,
    account: SquadsAccountRow,
    changeIndex: bigint,
  ): Promise<void> {
    const grant = await this.challenges.assertGrant(
      userId,
      grantId,
      'primary_rotation',
    );
    if (!grant.target) {
      throw new NoRotationInFlightError(
        'this recovery session names no address',
      );
    }
    const signer = await this.recovery.signerAnchoredOn(userId, grant.target);

    const addresses = deriveAccountAddresses(account.settingsSeed);
    const compiled = await this.chain.compile({
      instructions: [
        buildApproveSettingsChange({
          addresses,
          transactionIndex: changeIndex,
          signer: new PublicKey(signer.address),
        }),
      ],
    });

    const transaction = await this.recovery.approveWithRecoverySigner(
      userId,
      VersionedTransaction.deserialize(
        Buffer.from(compiled.unsignedTxBase64, 'base64'),
      ),
      signer.id,
    );

    const signature = await this.chain.submit(
      Buffer.from(transaction.serialize()).toString('base64'),
    );
    await this.challenges.consume(grantId);
    this.logger.log(
      `primary_rotation.recovery_approved userId=${userId} signature=${signature}`,
    );
  }

  /**
   * Commits the swap, or forgets it.
   *
   * Execution is also when the credential binding moves: the fresh passkey's
   * wallet-provider user takes over the smart_accounts row, so from the next
   * sign-in the new passkey opens this Account and the old one opens nothing.
   */
  private async settle(
    account: SquadsAccountRow,
    executed: boolean,
  ): Promise<void> {
    const changeIndex = account.pendingPrimaryChangeIndex;
    if (
      executed &&
      account.pendingPrimarySigner &&
      account.pendingPrimaryProviderId
    ) {
      // An executed proposal at the index proves a change landed there, not
      // that it was this one. Rebinding the credential on that alone would
      // hand the Account to a passkey the signer set never took.
      if (!(await this.rotationLanded(account))) {
        this.logger.error(
          `primary_rotation.signer_set_mismatch userId=${account.userId} index=${changeIndex}`,
        );
        throw new AccountCreationError(
          'the executed change did not install the staged primary signer',
        );
      }
      await this.commit(account);
    } else {
      await this.store.updateByUserId(account.userId, {
        pendingPrimarySigner: null,
        pendingPrimaryProviderId: null,
        pendingPrimaryChangeIndex: null,
      });
      if (changeIndex) {
        await this.events.recordSettingsChangeRejected(account.userId, {
          changeIndex,
          subject: account.pendingPrimarySigner,
        });
      }
    }

    this.logger.log(
      `primary_rotation.settled userId=${account.userId} executed=${executed}`,
    );
  }

  private async commit(account: SquadsAccountRow): Promise<void> {
    const newSigner = account.pendingPrimarySigner as string;
    await this.db.client
      .update(smartAccounts)
      .set({
        providerUserId: account.pendingPrimaryProviderId as string,
        walletAddress: newSigner,
        updatedAt: new Date(),
      })
      .where(eq(smartAccounts.userId, account.userId));
    await this.store.updateByUserId(account.userId, {
      primarySigner: newSigner,
      pendingPrimarySigner: null,
      pendingPrimaryProviderId: null,
      pendingPrimaryChangeIndex: null,
    });
    await this.events.recordPasskeyEnrolled(account.userId, {
      credentialId: newSigner,
    });
    if (account.pendingPrimaryChangeIndex) {
      await this.events.recordSettingsChangeExecuted(account.userId, {
        changeIndex: account.pendingPrimaryChangeIndex,
        subject: newSigner,
      });
    }
    // Best-effort; the reconciler is the safety net, and a rotation that
    // executed must not be reported failed over a webhook registration.
    try {
      await this.solana.registerWebhookAddress(newSigner);
    } catch (err) {
      this.logger.error(
        `Failed to register webhook address for ${newSigner} (continuing; reconciler will catch up)`,
        err,
      );
    }
  }

  private async prepare(
    userId: string,
    account: SquadsAccountRow,
    step: PrimaryRotationStep,
    changeIndex: bigint,
  ): Promise<PrimaryRotationPlan> {
    const { instructions } = await this.build(account, step, changeIndex);
    const unsigned = await this.chain.compile({ instructions });
    await this.prepared.set(
      preparedKey(userId),
      unsigned.messageBase64,
      PREPARED_TX_TTL_SECONDS,
    );

    this.logger.log(
      `primary_rotation.step userId=${userId} step=${step} index=${changeIndex}`,
    );

    return {
      done: false,
      step,
      ...unsigned,
      changeIndex: changeIndex.toString(),
      needsApprovalSignature: true,
      newPrimarySigner: account.pendingPrimarySigner ?? undefined,
    };
  }

  private async build(
    account: SquadsAccountRow,
    step: PrimaryRotationStep,
    transactionIndex: bigint,
  ): Promise<{ instructions: TransactionInstruction[] }> {
    const addresses = deriveAccountAddresses(account.settingsSeed);
    const approval = new PublicKey(account.approvalSigner);
    const rentPayer = new PublicKey(this.chain.rentPayer);

    if (step === 'propose') {
      if (!account.pendingPrimarySigner) {
        throw new NoRotationInFlightError('no rotation is staged');
      }
      // Both read live. A PolicyUpdate replaces the whole spending-limit
      // policy, so the limit is restated from what the chain holds rather
      // than from what provisioning wrote, and the signer set is what says
      // the approval signer may propose at all.
      const [settings, currentLimit] = await Promise.all([
        this.chain.readSettings(account.settingsAddress),
        this.chain.readSpendingLimit(
          account.settingsAddress,
          spendingLimitSeed(account),
        ),
      ]);
      const { propose } = buildRotatePrimarySigner({
        addresses,
        oldPrimary: new PublicKey(account.primarySigner),
        newPrimary: new PublicKey(account.pendingPrimarySigner),
        approval,
        signers: settings.signers,
        spendingLimitSeed: spendingLimitSeed(account),
        currentLimit,
        aboveLimitSeed: ABOVE_LIMIT_POLICY_SEED,
        proposer: approval,
        rentPayer,
        transactionIndex,
      });
      return { instructions: propose };
    }

    if (step === 'execute') {
      const policies = [
        derivePolicyAddress(addresses.settings, spendingLimitSeed(account)),
        derivePolicyAddress(addresses.settings, ABOVE_LIMIT_POLICY_SEED),
      ];
      return {
        instructions: [
          buildExecuteSettingsChange({
            addresses,
            transactionIndex,
            signer: approval,
            rentPayer,
            policies,
          }),
        ],
      };
    }

    return {
      instructions: [
        buildApproveSettingsChange({
          addresses,
          transactionIndex,
          signer: approval,
        }),
      ],
    };
  }

  private async heldRecoveryAddresses(userId: string): Promise<string[]> {
    const signers = await this.recovery.list(userId);
    const held = signers
      .filter(
        (signer) =>
          signer.channel === 'email' && signer.status !== 'pending_add',
      )
      .map((signer) => signer.address);
    if (held.length === 0) {
      throw new NoRotationInFlightError(
        'this Account has no email recovery signer',
      );
    }
    return held;
  }

  private executableAt(statusTimestamp: bigint | null): Date | null {
    if (statusTimestamp === null) return null;
    return new Date(
      (Number(statusTimestamp) + SETTINGS_TIME_LOCK_SECONDS) * 1000,
    );
  }

  private async assertMatchesPreparedStep(
    userId: string,
    signedTxBase64: string,
  ): Promise<void> {
    const expected = await this.prepared.get<string>(preparedKey(userId));
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

  private async requireAccount(userId: string): Promise<SquadsAccountRow> {
    const account = await this.store.findByUserId(userId);
    if (!account) {
      throw new AccountCreationError('No Account exists for this Consumer');
    }
    return account;
  }
}

function preparedKey(userId: string): string {
  return `primary-rotation:${userId}`;
}
