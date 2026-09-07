import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

const ACKNOWLEDGED_KEY = ["pending-change", "acknowledged"] as const;
const REVIEW_KEY = ["pending-change", "review-requested"] as const;
const ACKNOWLEDGED_STORE = "pending-change:acknowledged";

/**
 * The same request as `requestReview` below, from outside a component: a
 * tapped notification. Takes the client rather than being a hook so the
 * routing effect can call it without a fresh function in its dependencies.
 */
export async function requestPendingChangeReview(
  queryClient: QueryClient
): Promise<void> {
  await AsyncStorage.removeItem(ACKNOWLEDGED_STORE);
  queryClient.setQueryData(ACKNOWLEDGED_KEY, null);
  queryClient.setQueryData(REVIEW_KEY, true);
}

/**
 * Whether the Consumer has already answered the alarm for a given change.
 *
 * Shared rather than owned by the modal, because the home banner has to be able
 * to put the alarm back. Acknowledging is "not now", not "I consent": the
 * change is still coming, and the banner stays as the reminder. If tapping that
 * reminder could not reopen the one screen that offers to reject, answering the
 * modal once would quietly give up the only defence the time lock provides.
 */
export function usePendingChangeAcknowledgement() {
  const queryClient = useQueryClient();

  const { data: acknowledged, isPending } = useQuery({
    queryKey: ACKNOWLEDGED_KEY,
    queryFn: () => AsyncStorage.getItem(ACKNOWLEDGED_STORE),
    staleTime: Infinity,
  });

  const write = useMutation({
    mutationFn: async (index: string | null) => {
      if (index === null) await AsyncStorage.removeItem(ACKNOWLEDGED_STORE);
      else await AsyncStorage.setItem(ACKNOWLEDGED_STORE, index);
      return index;
    },
    onSuccess: (index) => queryClient.setQueryData(ACKNOWLEDGED_KEY, index),
  });

  const { data: reviewRequested } = useQuery({
    queryKey: REVIEW_KEY,
    queryFn: () => false,
    initialData: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  return {
    acknowledged,
    /** Still resolving the stored answer. Nothing should be shown yet. */
    isPending,
    acknowledge: (index: string) => write.mutate(index),
    /** Puts the alarm back, so "review" has something to open. */
    reopen: () => write.mutate(null),
    /**
     * Whether the Consumer asked to see the change, rather than being shown it.
     *
     * The suppression that keeps a phone quiet about its own change is about
     * what arrives unasked. Someone tapping "review" has asked, and the screen
     * that offers to call the change off is the only one worth opening, so the
     * request outranks the suppression. Session-only: it is an intent, not a
     * setting.
     */
    reviewRequested,
    requestReview: () => {
      write.mutate(null);
      queryClient.setQueryData(REVIEW_KEY, true);
    },
    clearReview: () => queryClient.setQueryData(REVIEW_KEY, false),
  };
}
