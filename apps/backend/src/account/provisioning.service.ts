import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import {
  buildApproveSettingsChange,
  buildExecuteSettingsChange,
  buildProvisionAccount,
  deriveAccountAddresses,
  derivePolicyAddress,
  SETTINGS_TIME_LOCK_SECONDS,
} from '@xend/smart-account';

import { AccountCreationError } from './account.errors';
import {
  ABOVE_LIMIT_POLICY_SEED,
  PROVISIONING_CHAIN,
  SPENDING_LIMIT_POLICY_SEED,
  SQUADS_ACCOUNT_STORE,
} from './account.interface';
import type {
  ProvisioningChain,
  ProvisioningPlan,
  ProvisioningStep,
  SquadsAccountRow,
  SquadsAccountStore,
} from './account.interface';
import { buildDefaultSpendingLimit } from './spending-limit.terms';
import { VersionedTransaction } from '@solana/web3.js';

/**
 * Walks a newly created Account through the settings change that makes it
 * usable, one signable transaction at a time.
 *
 * ## Why this is driven from the device
 *
 * The step here is a settings change, and a settings change needs the Account's
 * own threshold: two of S1, S2, S3. The backend holds only S3, and deliberately
 * so. Reaching threshold from the backend alone would mean holding a second
 * signer, which is the thing the whole 2-of-3 exists to prevent. So the backend
 * builds the transactions and the device signs them.
 *
 * ## Why it reads chain state instead of tracking progress
 *
 * Four transactions with a biometric prompt among them will be interrupted: a
 * backgrounded app, a dropped connection, a killed process. The chain already
 * knows exactly how far this got, which policies exist, what the lock is and
 * who has approved the proposal in flight, so that is the source of truth and
 * each call re-derives the next step from it. Nothing to reconcile, and a retry
 * is always safe.
 */
@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  /**
   * The message each Consumer was last asked to sign, by user id.
   *
   * The authority partially signs whatever arrives at `submit`, so without
   * this a caller could hand over any transaction naming the authority as fee
   * payer and have the backend sign and broadcast it. Pinning the prepared
   * message is the same guard the transfer flow applies to its intents.
   *
   * In memory, like those intents: a restart loses it, and the client simply
   * prepares again.
   */
  private readonly prepared = new Map<string, string>();

  constructor(
    @Inject(SQUADS_ACCOUNT_STORE) private readonly store: SquadsAccountStore,
    @Inject(PROVISIONING_CHAIN) private readonly chain: ProvisioningChain,
    private readonly config: ConfigService,
  ) {}

  async prepareNext(userId: string): Promise<ProvisioningPlan> {
    const account = await this.store.findByUserId(userId);
    if (!account) {
      throw new AccountCreationError('No Account exists for this Consumer');
    }

    const settings = await this.chain.readSettings(account.settingsAddress);

    if (await this.isProvisioned(account, settings.timeLockSeconds)) {
      this.logger.log(`provisioning.complete userId=${userId}`);
      return { done: true, needsApprovalSignature: false };
    }

    // A proposal sitting at the current index is the change in flight. Anything
    // settled means that index is spent and a fresh change starts at index+1.
    const inFlight = await this.chain.readProposal(
      account.settingsAddress,
      settings.transactionIndex,
    );
    const open = inFlight && !inFlight.settled ? inFlight : null;
    const transactionIndex = open
      ? settings.transactionIndex
      : settings.transactionIndex + 1n;

    const step = nextStep(open?.approved ?? null, account);
    const instructions = this.build(account, step, transactionIndex);

    // The fee payer is the settlement authority, chosen inside the chain: a
    // Consumer has funded nothing yet when these run, so neither S1 nor S2
    // can pay.
    const unsigned = await this.chain.compile({ instructions });

    this.prepared.set(userId, unsigned.messageBase64);

    this.logger.log(
      `provisioning.step userId=${userId} step=${step} index=${transactionIndex}`,
    );

    return {
      done: false,
      change: 'provision',
      step,
      ...unsigned,
      needsApprovalSignature:
        step === 'approve-approval' || step === 'provision',
    };
  }

  /**
   * Submits a step the device signed.
   *
   * Deliberately takes no claim about which step this is. The transaction was
   * compiled by `prepareNext` and is signed, so what it does is already fixed;
   * a step label from the client could only disagree with it, never change it.
   * The next call re-reads the chain and finds out what actually landed.
   */
  async submit(userId: string, signedTxBase64: string): Promise<string> {
    const account = await this.store.findByUserId(userId);
    if (!account) {
      throw new AccountCreationError('No Account exists for this Consumer');
    }

    this.assertMatchesPreparedStep(userId, signedTxBase64);

    const signature = await this.chain.submit(signedTxBase64);
    // Spent: a signed step is submitted once, and a replay has to prepare
    // again against the chain's current index.
    this.prepared.delete(userId);
    this.logger.log(
      `provisioning.step_landed userId=${userId} signature=${signature}`,
    );
    return signature;
  }

  /**
   * Refuses anything but the exact step this Consumer was last handed.
   *
   * The authority's signature is the thing being protected. It signs partially,
   * so a transaction that merely names the authority as fee payer would come
   * back signed and broadcast; comparing the compiled message means the only
   * bytes it will ever sign are bytes this service built.
   */
  private assertMatchesPreparedStep(userId: string, signedTxBase64: string) {
    const expected = this.prepared.get(userId);
    if (!expected) {
      throw new AccountCreationError(
        'No provisioning step is awaiting a signature for this Consumer',
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
        'signed transaction does not match the prepared provisioning step',
      );
    }
  }

  /**
   * Whether the Account already carries everything the change installs.
   *
   * Read from the chain rather than from a stored column so that an Account
   * provisioned by an older build, or half-provisioned by an interrupted run,
   * is diagnosed correctly rather than trusted. The time lock is checked first
   * because it is already in hand: the policies cost an RPC read each.
   */
  private async isProvisioned(
    account: SquadsAccountRow,
    timeLockSeconds: number,
  ): Promise<boolean> {
    if (timeLockSeconds === 0) return false;

    return (
      (await this.chain.policyExists(
        account.settingsAddress,
        SPENDING_LIMIT_POLICY_SEED,
      )) &&
      (await this.chain.policyExists(
        account.settingsAddress,
        ABOVE_LIMIT_POLICY_SEED,
      ))
    );
  }

  private build(
    account: SquadsAccountRow,
    step: ProvisioningStep,
    transactionIndex: bigint,
  ): TransactionInstruction[] {
    const addresses = deriveAccountAddresses(account.settingsSeed);
    const primary = new PublicKey(account.primarySigner);
    const approval = new PublicKey(account.approvalSigner);
    // Rent for the transaction, proposal and policy accounts, which the
    // proposer cannot cover: provisioning runs before the Consumer has funded
    // anything.
    const rentPayer = new PublicKey(this.chain.rentPayer);

    if (step === 'provision' || step === 'propose') {
      const { propose, policies } = buildProvisionAccount({
        addresses,
        spendingLimitSeed: SPENDING_LIMIT_POLICY_SEED,
        aboveLimitSeed: ABOVE_LIMIT_POLICY_SEED,
        // S1 alone spends under the limit, and is one of the two signers above
        // it. Naming S2 on the limit would put a biometric prompt on the
        // everyday path the limit exists to keep to one signature.
        primary,
        approval,
        proposer: primary,
        rentPayer,
        transactionIndex,
        timeLockSeconds: SETTINGS_TIME_LOCK_SECONDS,
        terms: buildDefaultSpendingLimit(
          new PublicKey(
            this.config.getOrThrow<string>('EXPO_PUBLIC_USDC_MINT_ADDRESS'),
          ),
        ),
      });
      if (step === 'propose') return propose;
      return [
        ...propose,
        buildApproveSettingsChange({
          addresses,
          transactionIndex,
          signer: primary,
        }),
        buildApproveSettingsChange({
          addresses,
          transactionIndex,
          signer: approval,
        }),
        buildExecuteSettingsChange({
          addresses,
          transactionIndex,
          signer: primary,
          rentPayer,
          policies,
        }),
      ];
    }

    if (step === 'execute') {
      return [
        buildExecuteSettingsChange({
          addresses,
          transactionIndex,
          signer: primary,
          rentPayer,
          // The policy accounts the change creates ride along as remaining
          // accounts, consumed in the order the change declared them.
          policies: [
            derivePolicyAddress(addresses.settings, SPENDING_LIMIT_POLICY_SEED),
            derivePolicyAddress(addresses.settings, ABOVE_LIMIT_POLICY_SEED),
          ],
        }),
      ];
    }

    return [
      buildApproveSettingsChange({
        addresses,
        transactionIndex,
        signer: step === 'approve-primary' ? primary : approval,
      }),
    ];
  }
}

/**
 * Which sub-step comes next, from who has already approved.
 *
 * `approved` is null when no proposal exists at this index yet, which is the
 * only case that starts a change rather than continuing one.
 */
function nextStep(
  approved: string[] | null,
  account: SquadsAccountRow,
): ProvisioningStep {
  // Nothing proposed at this index, so the whole change fits in one
  // transaction. The granular steps below only run when resuming a change an
  // interrupted older run left partway, which a single atomic transaction
  // can no longer produce.
  if (approved === null) return 'provision';
  if (!approved.includes(account.primarySigner)) return 'approve-primary';
  if (!approved.includes(account.approvalSigner)) return 'approve-approval';
  return 'execute';
}
