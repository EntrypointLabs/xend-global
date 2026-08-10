import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import type { SpendingLimit } from '@xend/smart-account';

import { AccountCreationError } from './account.errors';
import type { SpendChain } from './account.interface';

/**
 * Chain reads and transaction assembly for Spends, on web3.js per ADR 0020.
 */
@Injectable()
export class Web3SpendChain implements SpendChain, OnModuleInit {
  private readonly logger = new Logger(Web3SpendChain.name);
  private rpc!: Connection;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.rpc = new Connection(
      this.config.getOrThrow<string>('HELIUS_RPC_URL'),
      'confirmed',
    );
  }

  /**
   * No spending limits are created yet, so this returns none and every Spend
   * takes the two-signature route.
   *
   * That is the safe direction: an empty list forces more signatures, never
   * fewer. When limits do exist, this must read them from chain and must throw
   * on a read failure rather than returning none, because "none" here changes
   * how a Spend is authorised.
   */
  readSpendingLimits(): Promise<readonly SpendingLimit[]> {
    return Promise.resolve([]);
  }

  async compile(params: {
    instruction: TransactionInstruction;
    feePayer: PublicKey;
  }): Promise<{
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
        `Could not read a blockhash: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    const message = new TransactionMessage({
      payerKey: params.feePayer,
      recentBlockhash: blockhash,
      instructions: [params.instruction],
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
