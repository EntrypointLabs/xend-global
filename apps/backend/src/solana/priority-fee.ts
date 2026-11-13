import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';

/** The most addresses `getRecentPrioritizationFees` accepts. */
const MAX_LOCKED_ACCOUNTS = 128;

/**
 * Bid high in the recent range rather than at its top: one outlier slot should
 * not set the price of every transaction after it.
 */
const FEE_PERCENTILE = 0.75;

const logger = new Logger('PriorityFee');

/**
 * Prepends a compute unit price to a transaction Prydd pays for.
 *
 * Without one a transaction competes on the base fee alone, which lands on an
 * idle cluster and gets dropped on a busy one.
 *
 * It sets a price and no unit limit on purpose. A limit set too low fails a
 * transaction the Consumer has already approved, and the default limit costs
 * only a little more in a fee Prydd is paying anyway.
 */
export async function withPriorityFee(
  rpc: Connection,
  config: ConfigService,
  payer: PublicKey,
  instructions: TransactionInstruction[],
): Promise<TransactionInstruction[]> {
  const microLamports = await computeUnitPrice(
    rpc,
    config,
    writableAccounts(payer, instructions),
  );
  return [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
    ...instructions,
  ];
}

/**
 * Falls back to the floor when the read fails: a Consumer's money should not
 * wait on a fee estimate.
 */
async function computeUnitPrice(
  rpc: Connection,
  config: ConfigService,
  accounts: PublicKey[],
): Promise<number> {
  const floor = config.getOrThrow<number>('SOLANA_MIN_COMPUTE_UNIT_PRICE');
  const ceiling = config.getOrThrow<number>('SOLANA_MAX_COMPUTE_UNIT_PRICE');

  let fees: number[];
  try {
    const recent = await rpc.getRecentPrioritizationFees({
      lockedWritableAccounts: accounts,
    });
    fees = recent.map((slot) => slot.prioritizationFee).sort((a, b) => a - b);
  } catch (cause) {
    logger.warn(
      `priority_fee.read_failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return floor;
  }

  const market = fees[Math.floor(fees.length * FEE_PERCENTILE)] ?? 0;
  return Math.min(Math.max(market, floor), ceiling);
}

function writableAccounts(
  payer: PublicKey,
  instructions: TransactionInstruction[],
): PublicKey[] {
  const addresses = new Set([payer.toBase58()]);
  for (const instruction of instructions) {
    for (const key of instruction.keys) {
      if (key.isWritable) addresses.add(key.pubkey.toBase58());
    }
  }
  return [...addresses]
    .slice(0, MAX_LOCKED_ACCOUNTS)
    .map((address) => new PublicKey(address));
}
