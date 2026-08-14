import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  PublicKey,
  type AccountInfo,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { accounts, getProposalPda } from '@sqds/smart-account';
import { derivePolicyAddress } from '@xend/smart-account';

import {
  SETTLEMENT_AUTHORITY_SIGNER,
  type SettlementAuthoritySigner,
} from '../settlement/settlement-authority.interface';
import { AccountCreationError } from './account.errors';
import type {
  ProposalState,
  ProvisioningChain,
  SettingsState,
} from './account.interface';

/**
 * Chain reads and transaction assembly for provisioning, on web3.js per
 * ADR 0020.
 *
 * Every read here throws on failure rather than reporting an absence. The
 * service decides what to sign next from these answers, so a transient RPC
 * error reported as "no policy yet" would propose a policy that already exists
 * and waste two signatures and a biometric prompt on a transaction that cannot
 * land.
 */
@Injectable()
export class Web3ProvisioningChain implements ProvisioningChain, OnModuleInit {
  private readonly logger = new Logger(Web3ProvisioningChain.name);
  private rpc!: Connection;

  constructor(
    private readonly config: ConfigService,
    @Inject(SETTLEMENT_AUTHORITY_SIGNER)
    private readonly authority: SettlementAuthoritySigner,
  ) {}

  onModuleInit(): void {
    this.rpc = new Connection(
      this.config.getOrThrow<string>('HELIUS_RPC_URL'),
      'confirmed',
    );
  }

  async readSettings(settingsAddress: string): Promise<SettingsState> {
    try {
      const settings = await accounts.Settings.fromAccountAddress(
        this.rpc,
        new PublicKey(settingsAddress),
      );
      // transactionIndex is a u64 the SDK surfaces as a bignum, which is a BN
      // at runtime and loosely typed at compile time. Going through its string
      // form is the only conversion that survives values past 2^53.
      const index = settings.transactionIndex as unknown as {
        toString(): string;
      };
      return {
        timeLockSeconds: settings.timeLock,
        transactionIndex: BigInt(index.toString()),
      };
    } catch (cause) {
      throw new AccountCreationError(
        `Could not read the Account settings: ${describe(cause)}`,
      );
    }
  }

  async policyExists(
    settingsAddress: string,
    policySeed: bigint,
  ): Promise<boolean> {
    const policy = derivePolicyAddress(
      new PublicKey(settingsAddress),
      policySeed,
    );
    try {
      return (await this.rpc.getAccountInfo(policy)) !== null;
    } catch (cause) {
      throw new AccountCreationError(
        `Could not read policy ${policySeed}: ${describe(cause)}`,
      );
    }
  }

  async readProposal(
    settingsAddress: string,
    transactionIndex: bigint,
  ): Promise<ProposalState | null> {
    const [address] = getProposalPda({
      settingsPda: new PublicKey(settingsAddress),
      transactionIndex,
    });

    let info: AccountInfo<Buffer> | null;
    try {
      info = await this.rpc.getAccountInfo(address);
    } catch (cause) {
      throw new AccountCreationError(
        `Could not read the proposal at ${transactionIndex}: ${describe(cause)}`,
      );
    }
    if (!info) return null;

    const [proposal] = accounts.Proposal.fromAccountInfo(info);
    return {
      approved: proposal.approved.map((key) => key.toBase58()),
      // Active and Draft are the states with work left. Anything else — it
      // executed, or somebody rejected or cancelled it — means this index is
      // spent and the next change has to take a fresh one.
      settled: !['Active', 'Draft'].includes(proposal.status.__kind),
    };
  }

  async compile(params: { instructions: TransactionInstruction[] }): Promise<{
    unsignedTxBase64: string;
    messageBase64: string;
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    let blockhash: string;
    let lastValidBlockHeight: number;
    try {
      ({ blockhash, lastValidBlockHeight } =
        await this.rpc.getLatestBlockhash('confirmed'));
    } catch (cause) {
      throw new AccountCreationError(
        `Could not read a blockhash: ${describe(cause)}`,
      );
    }

    const message = new TransactionMessage({
      payerKey: new PublicKey(this.authority.address),
      recentBlockhash: blockhash,
      instructions: params.instructions,
    }).compileToV0Message();

    return {
      unsignedTxBase64: Buffer.from(
        new VersionedTransaction(message).serialize(),
      ).toString('base64'),
      messageBase64: Buffer.from(message.serialize()).toString('base64'),
      blockhash,
      lastValidBlockHeight,
    };
  }

  async submit(signedTxBase64: string): Promise<string> {
    let signature: string;
    try {
      // Adds the fee-payer signature to the device's, preserving it: the
      // authority signs partially, which is what this seam is built for.
      signature = await this.authority.signAndSend(signedTxBase64);
    } catch (cause) {
      throw new AccountCreationError(
        `Provisioning step was rejected: ${describe(cause)}`,
      );
    }

    try {
      const { blockhash, lastValidBlockHeight } =
        await this.rpc.getLatestBlockhash('confirmed');
      await this.rpc.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        'confirmed',
      );
    } catch (cause) {
      // It may still land. Reporting the signature rather than swallowing it
      // lets the caller re-read the chain instead of assuming either outcome.
      throw new AccountCreationError(
        `Provisioning step ${signature} did not confirm: ${describe(cause)}`,
      );
    }

    this.logger.log(`provisioning.submitted signature=${signature}`);
    return signature;
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
