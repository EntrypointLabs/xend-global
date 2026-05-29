import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/utils/apiClient";
import type { TransactionsDto } from "@/types/Backend";
import type { Transaction } from "@/types/Transaction";
import { toUiTransactions } from "./adapters/transactions";
import { usePollingEnabled } from "./usePollingEnabled";

interface UseTransactionsQueryOptions {
  /**
   * The user's Grid smart-account address. Used by the adapter to (a) filter
   * self-sends out of the inbound bucket and (b) attribute direction-tagged
   * Grid transfers correctly. Pass an empty string before the wallet query has
   * resolved — `enabled: false` keeps the query idle until you have it.
   */
  gridAccountId: string;
}

/**
 * Reads the merged DB+Grid transaction history and maps it through the UI
 * adapter before returning. Adapter handles dedupe-by-signature, direction
 * mapping, and self-send filtering, so screens consume `Transaction[]` only.
 *
 * Phase 7: polling on. Three gates compose on `enabled`: gridAccountId must
 * exist, the app must be foregrounded, and the user must be signed in. The
 * adapter sorts results descending by timestamp, which the receive-toast hook
 * relies on (newest at index 0).
 */
export function useTransactionsQuery(opts: UseTransactionsQueryOptions) {
  const pollingEnabled = usePollingEnabled();
  return useQuery<TransactionsDto, Error, Transaction[]>({
    queryKey: ["transactions", opts.gridAccountId],
    queryFn: () => apiClient.getTransactions(),
    select: (dto) => toUiTransactions(dto, opts.gridAccountId),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    enabled: pollingEnabled && !!opts.gridAccountId,
  });
}
