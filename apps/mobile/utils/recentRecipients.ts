import type { TransferRow } from "@/utils/apiClient";

export interface RecentRecipient {
  address: string;
  /** Sends to this address within the history that is loaded, never zero. */
  sends: number;
  /** ISO-8601, the most recent one, which is what the list is ordered by. */
  lastSentAt: string;
}

/** The fields of a feed row this needs, so a caller can pass a lighter shape. */
export type SendRow = Pick<
  TransferRow,
  "direction" | "kind" | "toAddress" | "createdAt"
>;

/**
 * Who the Consumer has been sending to, read back out of their Activity feed.
 *
 * Kept apart from the hook that feeds it: the grouping is where the behaviour
 * is, and it should be testable without a query client or a device.
 */
export function recentRecipientsFrom(
  rows: readonly SendRow[],
  excluded: ReadonlySet<string>,
  limit: number
): RecentRecipient[] {
  const byAddress = new Map<string, RecentRecipient>();

  for (const row of rows) {
    // Payments settle to a Merchant's address, which is not somewhere a
    // Consumer can usefully send to by hand.
    if (row.direction !== "SEND" || row.kind !== "transfer") continue;
    if (excluded.has(row.toAddress)) continue;

    const seen = byAddress.get(row.toAddress);
    if (seen) {
      seen.sends += 1;
      // The feed arrives newest first, so the first sighting is usually the
      // latest. Compared rather than assumed, because the chain fallback orders
      // by signature batch, which is close to that but not promised to be.
      if (row.createdAt > seen.lastSentAt) seen.lastSentAt = row.createdAt;
      continue;
    }
    byAddress.set(row.toAddress, {
      address: row.toAddress,
      sends: 1,
      lastSentAt: row.createdAt,
    });
  }

  return [...byAddress.values()]
    .sort((a, b) => b.lastSentAt.localeCompare(a.lastSentAt))
    .slice(0, limit);
}
