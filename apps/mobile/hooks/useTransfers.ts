import { useRef } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiClient } from "@/utils/apiClient";
import { fetchTransferRowsFromChain } from "@/utils/chainReads";
import { useAuth } from "@/contexts/AuthContext";
import { useUserId } from "@/hooks/useUserId";
import { useWalletAddress } from "@/hooks/useWalletAddress";

const PAGE_SIZE = 25;

/**
 * Cursor-paginated Activity feed for the signed-in user. Gated on
 * `isAuthenticated`; the JWT scopes the fetch server-side.
 *
 * Falls back to Solana RPC when the backend is unreachable. The chain-derived
 * feed is one page and carries no merchant names, but an Activity screen that
 * shows real transfers beats one that shows an error.
 */
export function useTransfersInfinite() {
  const { isAuthenticated } = useAuth();
  const userId = useUserId();
  const address = useWalletAddress();

  return useInfiniteQuery({
    queryKey: ["transfers", userId],
    queryFn: async ({ pageParam }) => {
      try {
        // Arrow-wrapped: apiClient methods rely on their receiver.
        return await apiClient.listTransfers({
          cursor: pageParam,
          limit: PAGE_SIZE,
        });
      } catch (error) {
        if (!address) throw error;
        return fetchTransferRowsFromChain(address, PAGE_SIZE);
      }
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(isAuthenticated),
    staleTime: 15000,
  });
}

/**
 * Lightweight 1-row head poll that drives the live PENDING -> CONFIRMED flip
 * without polling every page of the infinite query. While a PENDING transfer
 * exists it refetches the newest row every 5s; when that row's identity or
 * status changes it invalidates the full transfers query so the feed reloads.
 */
export function usePendingWatch(hasPending: boolean) {
  const { isAuthenticated } = useAuth();
  const userId = useUserId();
  const queryClient = useQueryClient();
  const lastHeadRef = useRef<string | null>(null);

  return useQuery({
    queryKey: ["transfers", "head", userId],
    queryFn: async () => {
      const res = await apiClient.listTransfers({ limit: 1 });
      const head = res.transfers[0];
      // Signature alone misses a same-signature PENDING -> CONFIRMED flip, so
      // fold in id + status to detect any change to the newest row.
      const headKey = head
        ? `${head.id}:${head.signature ?? ""}:${head.status}`
        : null;
      if (lastHeadRef.current !== null && lastHeadRef.current !== headKey) {
        queryClient.invalidateQueries({ queryKey: ["transfers", userId] });
      }
      lastHeadRef.current = headKey;
      return res;
    },
    enabled: Boolean(isAuthenticated) && hasPending,
    refetchInterval: hasPending ? 5000 : false,
    staleTime: 0,
  });
}
