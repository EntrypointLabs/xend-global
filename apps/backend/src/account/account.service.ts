import { Inject, Injectable, Logger } from '@nestjs/common';

import { RecoveryService } from '../recovery/recovery.service';
import { SOLANA_RPC } from '../solana/solana-rpc.interface';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import { TurnkeyService } from '../turnkey/turnkey.service';
import {
  AccountCreationError,
  IncompleteSignerSetError,
  SeedTakenError,
} from './account.errors';
import { ACCOUNT_CHAIN, SQUADS_ACCOUNT_STORE } from './account.interface';
import type {
  AccountChain,
  SignerAddresses,
  SquadsAccountRow,
  SquadsAccountStore,
} from './account.interface';

/** The seed is racy by construction, so a lost race is retried, not surfaced. */
const SEED_RETRIES = 3;

export interface CreateAccountParams {
  userId: string;
  /** S1. The Privy embedded wallet address, already provisioned at signup. */
  primarySigner: string;
  /** The device's hardware public key, which becomes S2's authenticator. */
  hardwarePublicKey: string;
  /** Where the attestation proved that key lives, recorded for a resume. */
  security?: string;
}

/**
 * Creates the Consumer's Squads smart account with its 2-of-3 signer set.
 *
 * ## Ordering
 *
 * Turnkey enrolment happens before anything is written on chain, because it is
 * the step most likely to fail and the only one that can leave state behind at
 * a vendor. An Account created first and then left without its approval signer
 * would be a 2-of-3 with two usable signers, which is a threshold-1 account
 * wearing a threshold-2 label.
 *
 * ## Idempotency
 *
 * A user with an Account gets it back. Creating a second would strand the
 * balance in the first, and the address is what a Consumer hands out.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    @Inject(ACCOUNT_CHAIN) private readonly chain: AccountChain,
    @Inject(SQUADS_ACCOUNT_STORE) private readonly store: SquadsAccountStore,
    private readonly turnkey: TurnkeyService,
    private readonly recovery: RecoveryService,
    @Inject(SOLANA_RPC) private readonly solana: SolanaRpc,
  ) {}

  findByUserId(userId: string): Promise<SquadsAccountRow | null> {
    return this.store.findByUserId(userId);
  }

  /**
   * The address a recovery code may be sent to.
   *
   * Read from the Account rather than accepted from the caller, so the only
   * inbox a code can reach is the one the recovery signer is anchored on.
   */
  contactEmail(userId: string): Promise<string | null> {
    return this.store.findUserEmail(userId);
  }

  createAccount(params: CreateAccountParams): Promise<SquadsAccountRow> {
    // The whole sequence, not just the write. The check that decides whether to
    // build an Account is at the top and the write that records it is at the
    // bottom, with a vendor call and an on-chain send in between; locking any
    // narrower leaves exactly the gap this is here to close.
    return this.store.withUserLock(params.userId, () => this.build(params));
  }

  private async build(params: CreateAccountParams): Promise<SquadsAccountRow> {
    const existing = await this.store.findByUserId(params.userId);
    if (existing) return existing;

    const approval = await this.turnkey.ensureApprovalSigner({
      reference: params.userId,
      hardwarePublicKey: params.hardwarePublicKey,
      security: params.security,
    });

    // Minted here rather than accepted from the caller. D10b makes S3
    // mandatory at creation, and a client-nominated address would hand one
    // caller two of the three signers.
    const email = await this.store.findUserEmail(params.userId);
    if (!email) {
      throw new IncompleteSignerSetError(
        'Cannot anchor a recovery signer: the Consumer has no email on file',
      );
    }
    const recovery = await this.recovery.ensureEmailSigner(
      params.userId,
      email,
    );

    const signers: SignerAddresses = {
      primary: params.primarySigner,
      approval: approval.address,
      recovery: recovery.address,
    };
    assertDistinctSigners(signers);

    const created = await this.createOnChainWithRetry(signers);

    this.logger.log(
      `account.created userId=${params.userId} vault=${created.vaultAddress}`,
    );

    const row = await this.store.insert({
      userId: params.userId,
      settingsSeed: created.settingsSeed,
      settingsAddress: created.settingsAddress,
      vaultAddress: created.vaultAddress,
      primarySigner: signers.primary,
      approvalSigner: signers.approval,
      approvalSubOrgId: approval.subOrganizationId,
    });

    // The vault needs its own subscription: the one registered at sign-up
    // covers the Privy wallet, and nothing about that address tells Helius to
    // watch the vault the Consumer actually receives at. Best-effort, matching
    // sign-up, because the boot replay is the safety net.
    try {
      await this.solana.registerWebhookAddress(created.vaultAddress);
    } catch (err) {
      this.logger.error(
        `Failed to register webhook address for vault ${created.vaultAddress} (continuing; reconciler will catch up)`,
        err,
      );
    }

    return row;
  }

  private async createOnChainWithRetry(signers: SignerAddresses) {
    let lastRace: SeedTakenError | undefined;

    for (let attempt = 1; attempt <= SEED_RETRIES; attempt++) {
      try {
        return await this.chain.createAccount(signers);
      } catch (cause) {
        if (!(cause instanceof SeedTakenError)) throw cause;
        lastRace = cause;
        this.logger.warn(
          `account.seed_taken attempt=${attempt}/${SEED_RETRIES}`,
        );
      }
    }

    throw new AccountCreationError(
      `Lost the settings seed race ${SEED_RETRIES} times: ${lastRace?.message}`,
    );
  }
}

/**
 * Two roles sharing an address collapses 2-of-3 into something one compromise
 * can satisfy. The package checks this too; checking here means the Turnkey
 * sub-org is the only thing wasted rather than an on-chain account.
 */
function assertDistinctSigners(signers: SignerAddresses): void {
  const present = Object.entries(signers).filter(([, address]) => !address);
  if (present.length > 0) {
    throw new IncompleteSignerSetError(
      `missing the ${present.map(([role]) => role).join(', ')} signer`,
    );
  }

  const unique = new Set(Object.values(signers));
  if (unique.size !== 3) {
    throw new IncompleteSignerSetError('signer addresses must be distinct');
  }
}
