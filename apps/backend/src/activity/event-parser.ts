import { Logger } from '@nestjs/common';
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
          fromAddress: t.fromUserAccount,
          toAddress: t.toUserAccount,
          confirmedAt,
        });
      }
    }
    return events;
  }
}
