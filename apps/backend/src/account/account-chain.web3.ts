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
    });

    const { blockhash } = await rpc.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({
      payerKey: creator,
      recentBlockhash: blockhash,
      instructions: [instruction],
    }).compileToV0Message();

    const wireTxBase64 = Buffer.from(
      new VersionedTransaction(message).serialize(),
    ).toString('base64');

    const signature = await this.send(wireTxBase64, settingsSeed);

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
 * A taken seed surfaces as the settings account already being initialised.
 * Matched on the message because the RPC error carries no structured code that
 * survives the base64 seam.
 */
function isSeedTaken(message: string): boolean {
  return (
    message.includes('already in use') ||
    message.includes('AccountAlreadyInitialized') ||
    message.includes('custom program error: 0x0')
  );
}
