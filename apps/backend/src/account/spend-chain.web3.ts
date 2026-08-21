import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  Connection,
  PublicKey,
  type AccountInfo,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { accounts } from '@sqds/smart-account';
import { derivePolicyAddress, type SpendingLimit } from '@xend/smart-account';

import {
  SETTLEMENT_AUTHORITY_SIGNER,
  type SettlementAuthoritySigner,
} from '../settlement/settlement-authority.interface';
import { AccountCreationError } from './account.errors';
import { SPENDING_LIMIT_POLICY_SEED } from './account.interface';
import type { SpendChain } from './account.interface';

/**
 * Chain reads and transaction assembly for Spends, on web3.js per ADR 0020.
 */
@Injectable()
export class Web3SpendChain implements SpendChain, OnModuleInit {
  private readonly logger = new Logger(Web3SpendChain.name);
  private rpc!: Connection;

  /** The settlement authority pays for every Spend; see the `compile` doc. */
  get feePayer(): string {
    return this.authority.address;
  }

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

  /**
   * Reads the Account's spending-limit policy.
   *
   * There is one, at a fixed seed, so this is a single account read rather than
   * a scan. An absent account is a real answer: provisioning creates the policy
   * after the Account, so a Consumer part-way through enrolment has no limit yet
   * and every Spend takes two signatures until they do.
   *
   * Anything else throws. Reporting a failure as "no limits" forces the safer
   * route, but it also makes a broken Account indistinguishable from an
   * unprovisioned one: an unreadable policy, or one of the wrong kind, would go
   * unnoticed for as long as two signatures keep working.
   */
  async readSpendingLimits(
    settingsAddress: string,
  ): Promise<readonly SpendingLimit[]> {
    const policy = derivePolicyAddress(
      new PublicKey(settingsAddress),
      SPENDING_LIMIT_POLICY_SEED,
    );

    let info: AccountInfo<Buffer> | null;
    try {
      info = await this.rpc.getAccountInfo(policy);
    } catch (cause) {
      throw new AccountCreationError(
        `Could not read the spending limit policy: ${describe(cause)}`,
      );
    }
    if (!info) return [];

    let state: accounts.Policy;
    try {
      [state] = accounts.Policy.fromAccountInfo(info);
    } catch (cause) {
      throw new AccountCreationError(
        `Could not decode the spending limit policy at ${policy.toBase58()}: ${describe(cause)}`,
      );
    }

    if (state.policyState.__kind !== 'SpendingLimit') {
      throw new AccountCreationError(
        `Policy ${policy.toBase58()} holds a ${state.policyState.__kind} policy, not a spending limit`,
      );
    }

    const [{ destinations, spendingLimit }] = state.policyState.fields;

    // Custom carries its own duration, so nothing we create can produce it: our
    // policy is written at a fixed seed under our own settings with a Daily
    // period. Reading one back means this policy is not the one provisioning
    // wrote, which is worth failing on rather than routing Spends against.
    const period = spendingLimit.timeConstraints.period;
    if (period.__kind === 'Custom') {
      throw new AccountCreationError(
        `Policy ${policy.toBase58()} carries a custom period, which provisioning never creates`,
      );
    }

    return [
      {
        policy,
        mint: spendingLimit.mint,
        maxPerUse: toBigInt(spendingLimit.quantityConstraints.maxPerUse),
        maxPerPeriod: toBigInt(spendingLimit.quantityConstraints.maxPerPeriod),
        period: period.__kind,
        // Taken as the chain currently records it. The program refills this
        // when a Spend lands in a new period, so a Consumer whose period has
        // rolled over reads low until then and is asked for the second
        // signature they would not strictly need.
        remainingInPeriod: toBigInt(spendingLimit.usage.remainingInPeriod),
        destinations,
      },
    ];
  }

  async tokenProgramFor(mint: string): Promise<PublicKey> {
    const info = await this.rpc.getAccountInfo(
      new PublicKey(mint),
      'confirmed',
    );
    if (!info) {
      throw new AccountCreationError(`Mint ${mint} does not exist on chain`);
    }
    // The account's owner IS its token program, which is the only source that
    // stays correct as Token-2022 mints appear alongside classic ones.
    return info.owner;
  }

  async wouldSucceed(instruction: TransactionInstruction): Promise<boolean> {
    try {
      const { blockhash } = await this.rpc.getLatestBlockhash('confirmed');
      const message = new TransactionMessage({
        payerKey: new PublicKey(this.authority.address),
        recentBlockhash: blockhash,
        instructions: [instruction],
      }).compileToV0Message();

      // Nobody has signed yet, and nobody needs to: the question is whether the
      // program accepts the Spend, not whether the signatures are real.
      const simulated = await this.rpc.simulateTransaction(
        new VersionedTransaction(message),
        {
          sigVerify: false,
          replaceRecentBlockhash: true,
          commitment: 'confirmed',
        },
      );
      return simulated.value.err === null;
    } catch (cause) {
      this.logger.warn(`spend.simulate_failed: ${describe(cause)}`);
      return false;
    }
  }

  async createDestinationTokenAccount(params: {
    mint: string;
    destination: string;
    tokenProgram: PublicKey;
  }): Promise<TransactionInstruction | null> {
    const mint = new PublicKey(params.mint);
    const destination = new PublicKey(params.destination);
    // Off-curve owners allowed: a recipient can be another Account's vault,
    // which is a PDA. The policy checks the account's owner against the
    // destination anyway, so refusing to derive it here only breaks the case
    // of one Account paying another.
    const ata = getAssociatedTokenAddressSync(
      mint,
      destination,
      true,
      params.tokenProgram,
    );
    if (await this.rpc.getAccountInfo(ata, 'confirmed')) return null;

    return createAssociatedTokenAccountInstruction(
      new PublicKey(this.feePayer),
      ata,
      destination,
      mint,
      params.tokenProgram,
    );
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
      payerKey: new PublicKey(this.feePayer),
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
}

/**
 * A u64 as the SDK surfaces it: a BN at runtime, loosely typed at compile time.
 * Going through the string form is the only conversion that survives values
 * past 2^53.
 */
function toBigInt(value: unknown): bigint {
  return BigInt((value as { toString(): string }).toString());
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
