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
const KEEP = 8;

async function readAcknowledged(): Promise<string[] | null> {
  const raw = await AsyncStorage.getItem(ACKNOWLEDGED_STORE);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as string[];
    // One index on its own is what this held before it held several, and a
    // bare number parses as JSON.
    return [String(parsed)];
  } catch {
    return [raw];
  }
}

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
    queryFn: async () => readAcknowledged(),
    staleTime: Infinity,
  });

  // Null clears every answer, which is what puts the alarm back. An index is
  // added to the ones already answered: several changes can wait at once, and
  // answering the second must not ring the first again.
  const write = useMutation({
    mutationFn: async (index: string | null) => {
      if (index === null) {
        await AsyncStorage.removeItem(ACKNOWLEDGED_STORE);
        return null;
      }
      const next = [
        index,
        ...((await readAcknowledged()) ?? []).filter((i) => i !== index),
      ].slice(0, KEEP);
      await AsyncStorage.setItem(ACKNOWLEDGED_STORE, JSON.stringify(next));
      return next;
    },
    onSuccess: (next) => queryClient.setQueryData(ACKNOWLEDGED_KEY, next),
  });

  const { data: reviewRequested } = useQuery({
    queryKey: REVIEW_KEY,
    queryFn: () => false,
    initialData: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  return {
    isAcknowledged: (index: string) => (acknowledged ?? []).includes(index),
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
