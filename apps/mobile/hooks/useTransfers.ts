import { useRef } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiClient } from "@/utils/apiClient";
import { showToast } from "@/utils/toast";
import { arrivalLabel } from "@/utils/activity";
import { fetchTransferRowsFromChain } from "@/utils/chainReads";
import { useAuth } from "@/contexts/AuthContext";
import { useUserId } from "@/hooks/useUserId";
import { useWalletAddress } from "@/hooks/useWalletAddress";

const PAGE_SIZE = 25;

/** While a transfer of theirs is in flight and they are watching for it. */
const PENDING_POLL_MS = 5_000;
/** Otherwise: often enough that an arrival feels immediate, rarely enough to ignore. */
const IDLE_POLL_MS = 15_000;
/**
 * A gap this much larger than the poll only happens because the app was
 * backgrounded, which is the one case an arrival must not be toasted.
 */
const AWAY_GAP_MS = IDLE_POLL_MS * 3;

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
 * Lightweight 1-row head poll: the cheapest way to notice that anything
 * happened to this wallet.
 *
 * It runs whenever the Consumer is signed in, not only while one of their own
 * transfers is pending. Money arriving is the case nobody can predict, and
 * before this a deposit sat unseen until something else happened to trigger a
 * refetch — which is not how a wallet is supposed to behave.
 *
 * Faster while a transfer of theirs is in flight, because that is the one
 * moment they are watching the screen waiting for a specific answer.
 *
 * A change to the newest row invalidates the feed AND the balances, since an
 * arrival moves both and refreshing one without the other leaves the two
 * disagreeing on screen.
 *
 * This is a poll, not a push. It stops when the app is backgrounded, so it
 * costs nothing while nobody is looking; a server-pushed channel would still
 * be better and is not what this is.
 *
 * An arrival seen here raises a toast, but only one that happened while the
 * Consumer was actually looking. Money that landed while they were away is
 * the push notification's job, and announcing it again on return would tell
 * them twice about one payment.
 */
export function usePendingWatch(hasPending = false) {
  const { isAuthenticated } = useAuth();
  const userId = useUserId();
  const queryClient = useQueryClient();
  // `null` is a real head value: a wallet with no activity yet. Overloading it
  // to also mean "never polled" made a new Consumer's first deposit invisible,
  // because the very transition that should announce it looked like the first
  // observation. A separate flag keeps the two apart.
  const hasPolledRef = useRef(false);
  const lastHeadRef = useRef<string | null>(null);
  const lastHeadIdRef = useRef<string | null>(null);
  const lastSeenAtRef = useRef<number>(0);

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

      const seenAt = Date.now();
      const previousSeenAt = lastSeenAtRef.current;
      lastSeenAtRef.current = seenAt;

      if (hasPolledRef.current && lastHeadRef.current !== headKey) {
        queryClient.invalidateQueries({ queryKey: ["transfers", userId] });
        queryClient.invalidateQueries({ queryKey: ["balances", userId] });

        // A gap far longer than the poll means the app was backgrounded, so
        // this arrival is news from while they were away rather than
        // something that just happened in front of them.
        const wasWatching = seenAt - previousSeenAt < AWAY_GAP_MS;
        const isNewArrival =
          head !== undefined &&
          head.id !== lastHeadIdRef.current &&
          head.direction === "RECEIVE" &&
          head.status === "CONFIRMED";

        if (wasWatching && isNewArrival) showToast(arrivalLabel(head));
      }

      hasPolledRef.current = true;
      lastHeadRef.current = headKey;
      lastHeadIdRef.current = head?.id ?? null;
      return res;
    },
    enabled: Boolean(isAuthenticated),
    refetchInterval: hasPending ? PENDING_POLL_MS : IDLE_POLL_MS,
    staleTime: 0,
  });
}
