import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import {
  buildApproveSettingsChange,
  buildCreateAboveLimitPolicy,
  buildCreateSpendingLimitPolicy,
  buildExecuteSettingsChange,
  buildSetTimeLock,
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
  ProvisioningChange,
  ProvisioningPlan,
  ProvisioningStep,
  SquadsAccountRow,
  SquadsAccountStore,
} from './account.interface';
import { buildDefaultSpendingLimit } from './spending-limit.terms';

/**
 * Walks a newly created Account through the settings changes that make it
 * usable, one signable transaction at a time.
 *
 * ## Why this is driven from the device
 *
 * Every step here is a settings change, and a settings change needs the
 * Account's own threshold: two of S1, S2, S3. The backend holds only S3, and
 * deliberately so. Reaching threshold from the backend alone would mean holding
 * a second signer, which is the thing the whole 2-of-3 exists to prevent. So
 * the backend builds the transactions and the device signs them.
 *
 * ## Why it reads chain state instead of tracking progress
 *
 * Twelve transactions with a biometric prompt among them will be interrupted:
 * a backgrounded app, a dropped connection, a killed process. The chain already
 * knows exactly how far this got — which policies exist, what the lock is, who
 * has approved the proposal in flight — so that is the source of truth and each
 * call re-derives the next step from it. Nothing to reconcile, and a retry is
 * always safe.
 */
@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

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
    const change = await this.nextChange(account, settings.timeLockSeconds);

    if (!change) {
      this.logger.log(`provisioning.complete userId=${userId}`);
      return { done: true, needsApprovalSignature: false };
    }

    // A proposal sitting at the current index is the change in flight. Anything
    // settled means that index is spent and the next change starts at index+1.
    const inFlight = await this.chain.readProposal(
      account.settingsAddress,
      settings.transactionIndex,
    );
    const open = inFlight && !inFlight.settled ? inFlight : null;
    const transactionIndex = open
      ? settings.transactionIndex
      : settings.transactionIndex + 1n;

    const step = nextStep(open?.approved ?? null, account);
    const instructions = this.build(account, change, step, transactionIndex);

    const unsigned = await this.chain.compile({
      instructions,
      // S1 pays every step. S2's wallet is a Turnkey signer with no lamports,
      // and the relayer's allowlist excludes the smart-account program.
      feePayer: new PublicKey(account.primarySigner),
    });

    this.logger.log(
      `provisioning.step userId=${userId} change=${change} step=${step} index=${transactionIndex}`,
    );

    return {
      done: false,
      change,
      step,
      ...unsigned,
      needsApprovalSignature: step === 'approve-approval',
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

    const signature = await this.chain.submit(signedTxBase64);
    this.logger.log(
      `provisioning.step_landed userId=${userId} signature=${signature}`,
    );
    return signature;
  }

  /**
   * The first change that has not landed, or null when the Account is ready.
   *
   * Read from the chain rather than from a stored column so that an Account
   * provisioned by an older build, or half-provisioned by an interrupted run,
   * is diagnosed correctly rather than trusted.
   */
  private async nextChange(
    account: SquadsAccountRow,
    timeLockSeconds: number,
  ): Promise<ProvisioningChange | null> {
    const hasLimit = await this.chain.policyExists(
      account.settingsAddress,
      SPENDING_LIMIT_POLICY_SEED,
    );
    if (!hasLimit) return 'spending-limit';

    const hasAbove = await this.chain.policyExists(
      account.settingsAddress,
      ABOVE_LIMIT_POLICY_SEED,
    );
    if (!hasAbove) return 'above-limit';

    return timeLockSeconds === 0 ? 'time-lock' : null;
  }

  private build(
    account: SquadsAccountRow,
    change: ProvisioningChange,
    step: ProvisioningStep,
    transactionIndex: bigint,
  ): TransactionInstruction[] {
    const addresses = deriveAccountAddresses(account.settingsSeed);
    const primary = new PublicKey(account.primarySigner);
    const approval = new PublicKey(account.approvalSigner);

    if (step === 'propose') {
      switch (change) {
        case 'spending-limit':
          return buildCreateSpendingLimitPolicy({
            addresses,
            policySeed: SPENDING_LIMIT_POLICY_SEED,
            // S1 alone spends under the limit. Naming S2 here would put a
            // biometric prompt on the everyday path the limit exists to keep
            // to one signature.
            limitSigner: primary,
            proposer: primary,
            transactionIndex,
            terms: buildDefaultSpendingLimit(
              new PublicKey(
                this.config.getOrThrow<string>('EXPO_PUBLIC_USDC_MINT_ADDRESS'),
              ),
            ),
          }).propose;

        case 'above-limit':
          return buildCreateAboveLimitPolicy({
            addresses,
            policySeed: ABOVE_LIMIT_POLICY_SEED,
            primary,
            approval,
            proposer: primary,
            transactionIndex,
          }).propose;

        case 'time-lock':
          // Returns the instructions directly: unlike the policy builders it
          // creates no account, so there is nothing to hand back alongside.
          return buildSetTimeLock({
            addresses,
            proposer: primary,
            transactionIndex,
            seconds: SETTINGS_TIME_LOCK_SECONDS,
          });
      }
    }

    if (step === 'execute') {
      return [
        buildExecuteSettingsChange({
          addresses,
          transactionIndex,
          signer: primary,
          // The accounts the change creates ride along as remaining accounts.
          // Raising the lock creates nothing, so that one passes none.
          policies: policiesFor(change, addresses.settings),
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
  if (approved === null) return 'propose';
  if (!approved.includes(account.primarySigner)) return 'approve-primary';
  if (!approved.includes(account.approvalSigner)) return 'approve-approval';
  return 'execute';
}

function policiesFor(
  change: ProvisioningChange,
  settings: PublicKey,
): PublicKey[] {
  switch (change) {
    case 'spending-limit':
      return [derivePolicyAddress(settings, SPENDING_LIMIT_POLICY_SEED)];
    case 'above-limit':
      return [derivePolicyAddress(settings, ABOVE_LIMIT_POLICY_SEED)];
    case 'time-lock':
      return [];
  }
}
