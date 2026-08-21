import { Inject, Injectable, Logger } from '@nestjs/common';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import {
  buildRejectSettingsChange,
  deriveAccountAddresses,
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
}

@Injectable()
export class AccountChangeService {
  private readonly logger = new Logger(AccountChangeService.name);

  /**
   * The rejection each Consumer was last handed, by user id.
   *
   * Same reason as provisioning: the authority partially signs whatever arrives
   * at submit, so the bytes have to be pinned to what was prepared or the
   * endpoint becomes a way to have the backend sign anything.
   */
  private readonly prepared = new Map<string, string>();

  constructor(
    @Inject(SQUADS_ACCOUNT_STORE) private readonly store: SquadsAccountStore,
    @Inject(PROVISIONING_CHAIN) private readonly chain: ProvisioningChain,
  ) {}

  /** The change awaiting execution on this Consumer's Account, if any. */
  async pending(userId: string): Promise<StagedChange | null> {
    const account = await this.store.findByUserId(userId);
    if (!account) return null;
    return this.pendingFor(account);
  }

  async pendingFor(account: SquadsAccountRow): Promise<StagedChange | null> {
    const settings = await this.chain.readSettings(account.settingsAddress);

    // Before provisioning finishes, the only change in flight is the one the
    // Consumer is making.
    if (!(await this.isProvisioned(account, settings.timeLockSeconds))) {
      return null;
    }

    const proposal = await this.chain.readProposal(
      account.settingsAddress,
      settings.transactionIndex,
    );
    if (!proposal || proposal.settled) return null;

    return {
      transactionIndex: settings.transactionIndex.toString(),
      status: proposal.status,
      approvals: proposal.approved,
      executableAt:
        proposal.status === 'Approved' && proposal.statusTimestamp !== null
          ? new Date(
              Number(
                proposal.statusTimestamp + BigInt(SETTINGS_TIME_LOCK_SECONDS),
              ) * 1000,
            ).toISOString()
          : null,
    };
  }

  /**
   * Builds the rejection for the Consumer to sign with S1.
   *
   * S1 because it is the signer the app can reach without a biometric prompt,
   * and rejecting has to be the cheapest action in the flow. A Consumer who is
   * being shown a change they did not make should not have to work for the
   * refusal.
   */
  async prepareRejection(userId: string): Promise<{
    unsignedTxBase64: string;
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    const account = await this.store.findByUserId(userId);
    if (!account) {
      throw new AccountCreationError('No Account exists for this Consumer');
    }

    const staged = await this.pendingFor(account);
    if (!staged) {
      throw new AccountCreationError(
        'No settings change is awaiting a decision',
      );
    }

    const instruction = buildRejectSettingsChange({
      addresses: deriveAccountAddresses(account.settingsSeed),
      transactionIndex: BigInt(staged.transactionIndex),
      signer: new PublicKey(account.primarySigner),
    });

    const unsigned = await this.chain.compile({ instructions: [instruction] });
    this.prepared.set(userId, unsigned.messageBase64);

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
    const expected = this.prepared.get(userId);
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
    if (submitted !== expected) {
      throw new AccountCreationError(
        'signed transaction does not match the prepared rejection',
      );
    }

    const signature = await this.chain.submit(signedTxBase64);
    this.prepared.delete(userId);
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
        SPENDING_LIMIT_POLICY_SEED,
      )) &&
      (await this.chain.policyExists(
        account.settingsAddress,
        ABOVE_LIMIT_POLICY_SEED,
      ))
    );
  }
}
