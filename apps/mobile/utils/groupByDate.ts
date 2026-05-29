import type { Transaction } from "@/types/Transaction";

export interface TransactionGroup {
  title: string;
  data: Transaction[];
}

/**
 * Group `Transaction[]` by calendar day (e.g. "October 3, 2025") and return
 * newest-first sections suitable for `<TransactionList />` or `<ActivityList />`.
 *
 * Input is assumed to be the adapter output (already sorted by descending
 * timestamp); this function just buckets by day and preserves the order within
 * each bucket.
 */
export function groupByDate(transactions: Transaction[]): TransactionGroup[] {
  const byDate = new Map<string, Transaction[]>();

  for (const tx of transactions) {
    const day = new Date(tx.timestamp).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const bucket = byDate.get(day);
    if (bucket) {
      bucket.push(tx);
    } else {
      byDate.set(day, [tx]);
    }
  }

  return Array.from(byDate.entries()).map(([title, data]) => ({ title, data }));
}
