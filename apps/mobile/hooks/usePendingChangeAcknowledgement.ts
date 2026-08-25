import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const ACKNOWLEDGED_KEY = ["pending-change", "acknowledged"] as const;
const ACKNOWLEDGED_STORE = "pending-change:acknowledged";

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

  return {
    acknowledged,
    /** Still resolving the stored answer. Nothing should be shown yet. */
    isPending,
    acknowledge: (index: string) => write.mutate(index),
    /** Puts the alarm back, so "review" has something to open. */
    reopen: () => write.mutate(null),
  };
}
