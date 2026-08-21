import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  buildCreateAccount,
  fetchProgramConfig,
  nextSettingsSeed,
} from '@xend/smart-account';

import {
  SETTLEMENT_AUTHORITY_SIGNER,
  type SettlementAuthoritySigner,
} from '../settlement/settlement-authority.interface';
import { AccountCreationError, SeedTakenError } from './account.errors';
import type {
  AccountChain,
  CreatedAccount,
  SignerAddresses,
} from './account.interface';

/**
 * Creates the Account on chain with `@xend/smart-account` and `@solana/web3.js`,
 * per ADR 0020: the package is web3.js-based, so the whole transaction is built
 * on that toolchain and crosses the seam as base64 bytes.
 *
 * ## Who pays
 *
 * The settlement authority, not the relayer. The relayer's allowlist
 * deliberately excludes the System program, so it cannot pay for an account
 * whose cost is almost entirely rent. The authority already owns the ops paths
 * that need System (settlement account provisioning, refunds), and reusing it
 * means Account creation adds no new key to hold.
 */
@Injectable()
export class Web3AccountChain implements AccountChain, OnModuleInit {
  private readonly logger = new Logger(Web3AccountChain.name);
  private rpc!: Connection;

  constructor(
    private readonly config: ConfigService,
    @Inject(SETTLEMENT_AUTHORITY_SIGNER)
    private readonly authority: SettlementAuthoritySigner,
  ) {}

  onModuleInit(): void {
    // Same URL as HeliusAdapter, which embeds its API key, so it is never
    // logged. Reads only; the send goes out through the authority's seam.
    this.rpc = new Connection(
      this.config.getOrThrow<string>('HELIUS_RPC_URL'),
      'confirmed',
    );
  }

  async createAccount(signers: SignerAddresses): Promise<CreatedAccount> {
    const rpc = this.rpc;
    const creator = new PublicKey(this.authority.address);

    const config = await fetchProgramConfig(rpc);
    const settingsSeed = nextSettingsSeed(config);

    const { instruction, addresses } = buildCreateAccount({
      signers: [
        { role: 'primary', address: new PublicKey(signers.primary) },
        { role: 'approval', address: new PublicKey(signers.approval) },
        { role: 'recovery', address: new PublicKey(signers.recovery) },
      ],
      creator,
      treasury: config.treasury,
      settingsSeed,
      // Created open, then closed by provisioning once both policies exist.
      //
      // The default is D3's 24 hours, and taking it here would make the
      // Account unusable for its first day: a policy is added by a settings
      // change, a settings change waits out the lock in force, and every Spend
      // runs under a policy. So the Account would sit locked with no way to
      // move money until the lock it was born with had elapsed.
      //
      // The exposure is small and bounded. A settings change still needs two
      // of three signatures, so a zero lock removes the notification window,
      // not the threshold, and the window only matters to a Consumer who still
      // holds S2 and can reject. It closes as soon as provisioning finishes,
      // which happens on the device right after enrolment and before the sweep
      // puts anything in the vault.
      timeLockSeconds: 0,
    });

    const { blockhash, lastValidBlockHeight } =
      await rpc.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({
      payerKey: creator,
      recentBlockhash: blockhash,
      instructions: [instruction],
    }).compileToV0Message();

    const wireTxBase64 = Buffer.from(
      new VersionedTransaction(message).serialize(),
    ).toString('base64');

    const signature = await this.send(wireTxBase64, settingsSeed);

    // A signature means the RPC took the bytes, not that the Account exists:
    // the send sets maxRetries 0, so a dropped transaction still returns one.
    // Persisted on that alone, every later attempt reads back a stored Account
    // whose settings and vault were never created, and provisioning has
    // nothing to work against for good.
    try {
      await rpc.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        'confirmed',
      );
    } catch (cause) {
      // It may yet land. Naming the signature lets the next attempt re-read
      // the chain rather than assume either outcome.
      throw new AccountCreationError(
        `Account creation ${signature} did not confirm: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    return {
      settingsSeed,
      settingsAddress: addresses.settings.toBase58(),
      vaultAddress: addresses.vault.toBase58(),
      signature,
    };
  }

  private async send(
    wireTxBase64: string,
    settingsSeed: bigint,
  ): Promise<string> {
    try {
      return await this.authority.signAndSend(wireTxBase64);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);

      // The seed comes from a global counter shared with every other user of
      // the program, so another creator can take it between the config read
      // and the send. The settings account then already exists.
      if (isSeedTaken(message)) {
        this.logger.warn(`account.seed_taken seed=${settingsSeed}`);
        throw new SeedTakenError(
          `settings seed ${settingsSeed} was claimed by another creator`,
        );
      }

      throw new AccountCreationError(
        `Could not create the Account on chain: ${message}`,
      );
    }
  }
}

/**
 * A taken seed surfaces two different ways, and the second one is the common
 * one.
 *
 * The obvious shape is the settings account already being initialised. What
 * actually happens most of the time is `MissingAccount` (6024, 0x1788): the
 * program derives the settings account it expects from the program config's
 * own counter, so once another creator has advanced that counter, the settings
 * account we derived from the stale value is not the one it looks for and it
 * reports the account as missing rather than as taken.
 *
 * Confirmed by simulating both against the deployed program: a seed of
 * `index + 1` simulates clean, and a seed five behind returns 6024. Treating
 * that as anything but a lost race skips the retry, which on a busy cluster
 * fails most creations — the global counter moved twelve places in an hour on
 * devnet.
 *
 * Matched on the message because the RPC error carries no structured code that
 * survives the base64 seam. Safe to scope this broadly: the only instruction
 * this class ever sends is CreateSmartAccount, and the settings PDA is the only
 * account in it that depends on the seed.
 */
function isSeedTaken(message: string): boolean {
  return (
    message.includes('already in use') ||
    message.includes('AccountAlreadyInitialized') ||
    message.includes('custom program error: 0x0') ||
    message.includes('MissingAccount') ||
    message.includes('custom program error: 0x1788')
  );
}
