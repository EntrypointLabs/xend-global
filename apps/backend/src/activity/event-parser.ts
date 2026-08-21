import { Logger } from '@nestjs/common';
import { WRAPPED_SOL_MINT } from '../solana/web3-connection';

/** Lamports per SOL is 10^9, so native amounts carry nine decimals. */
const LAMPORT_DECIMALS = 9;
import type { ConfirmedTransferEvent } from '../solana/solana-rpc.interface';

/**
 * Helius enhanced-transactions webhook payload. Helius posts an array of
 * decoded transactions to `/webhooks/helius`, each carrying top-level
 * metadata + a `tokenTransfers` list of decoded SPL token movements.
 *
 * Reference: https://docs.helius.dev/webhooks/api-reference
 *
 * The type is deliberately narrowed to the fields we read; Helius adds
 * more (events.nft, events.swap, etc.) that the activity feed does not
 * surface.
 */
export interface HeliusTokenTransfer {
  fromUserAccount: string | null;
  toUserAccount: string | null;
  fromTokenAccount?: string | null;
  toTokenAccount?: string | null;
  tokenAmount: number;
  /** raw integer string, when available (newer Helius schema) */
  rawTokenAmount?: { tokenAmount: string; decimals: number };
  mint: string;
}

/**
 * A native SOL movement. Helius reports these separately from token transfers
 * because native SOL is not an SPL token and has no token account.
 */
export interface HeliusNativeTransfer {
  fromUserAccount: string | null;
  toUserAccount: string | null;
  /** Lamports, already an integer. */
  amount: number;
}

export interface HeliusEnhancedTransaction {
  signature: string;
  slot: number;
  timestamp: number;
  type?: string;
  source?: string;
  fee?: number;
  feePayer?: string;
  transactionError?: { InstructionError?: unknown } | null;
  tokenTransfers?: HeliusTokenTransfer[];
  nativeTransfers?: HeliusNativeTransfer[];
}

export type HeliusWebhookBody = HeliusEnhancedTransaction[];

/**
 * Projects a Helius webhook delivery into the provider-neutral
 * `ConfirmedTransferEvent` shape the tailer writes.
 *
 * One Helius transaction can include zero or more SPL token transfers,
 * which are flattened. Transactions with `transactionError != null` are
 * dropped — they failed on chain and any `transfers` rows for them come
 * from the reconciler poll path that maps cluster errors to FAILED.
 *
 * When `rawTokenAmount.tokenAmount` is present it is used directly
 * (preserves u64 precision). When only the float `tokenAmount` is
 * present (older schema), the raw integer is reconstructed from
 * `tokenAmount * 10^decimals` — lossy for very large amounts but
 * acceptable for stablecoins (which Helius returns with rawTokenAmount
 * populated).
 */
export class EventParser {
  private readonly logger = new Logger(EventParser.name);

  parseDecoded(body: HeliusWebhookBody): ConfirmedTransferEvent[] {
    if (!Array.isArray(body)) return [];
    const events: ConfirmedTransferEvent[] = [];
    for (const tx of body) {
      if (tx.transactionError) continue;
      const confirmedAt = new Date(tx.timestamp * 1000);
      const slot = BigInt(tx.slot);
      for (const t of tx.tokenTransfers ?? []) {
        if (!t.fromUserAccount || !t.toUserAccount) continue;
        let amountRaw: bigint;
        if (t.rawTokenAmount?.tokenAmount) {
          try {
            amountRaw = BigInt(t.rawTokenAmount.tokenAmount);
          } catch {
            this.logger.warn(
              `Skipping tokenTransfer with malformed rawTokenAmount in ${tx.signature}`,
            );
            continue;
          }
        } else if (typeof t.tokenAmount === 'number') {
          // Reconstruct integer from the float. Lossy for >2^53 raw,
          // but stablecoin amounts (6 decimals) stay well inside the
          // safe-integer range for any consumer-scale transfer.
          const decimals = t.rawTokenAmount?.decimals ?? 6;
          amountRaw = BigInt(
            Math.round(t.tokenAmount * Math.pow(10, decimals)),
          );
        } else {
          continue;
        }
        events.push({
          signature: tx.signature,
          slot,
          mint: t.mint,
          amountRaw,
          decimals: t.rawTokenAmount?.decimals ?? null,
          fromAddress: t.fromUserAccount,
          toAddress: t.toUserAccount,
          confirmedAt,
        });
      }

      // Native SOL, under the wrapped-SOL mint so it reads as the same asset
      // the balance reports. Without this a Consumer's SOL shows up in their
      // balance but never in their activity.
      for (const n of tx.nativeTransfers ?? []) {
        if (!n.fromUserAccount || !n.toUserAccount) continue;
        if (!Number.isFinite(n.amount)) continue;
        events.push({
          signature: tx.signature,
          slot,
          mint: WRAPPED_SOL_MINT,
          amountRaw: BigInt(Math.round(n.amount)),
          decimals: LAMPORT_DECIMALS,
          fromAddress: n.fromUserAccount,
          toAddress: n.toUserAccount,
          confirmedAt,
        });
      }
    }
    return events;
  }
}
