import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const INITIATED_KEY = ["pending-change", "initiated"] as const;
const INITIATED_STORE = "pending-change:initiated";

/**
 * The settings changes this phone started.
 *
 * Whether a change is the Consumer's own doing is a fact about a device, not
 * about an Account, and only the device that started it knows. The server
 * cannot tell them apart: it sees one Account with one staged change, so a flag
 * it sets would silence the alarm everywhere, including on the phone somebody
 * is trying to take the Account away from. That is the one place it has to ring.
 *
 * So the phone that starts a change writes the index down, and only that phone
 * stays quiet about it. Every other device the Consumer is signed in on still
 * gets the alarm.
 *
 * Stored as a short list rather than a single value: a change can still be
 * waiting out its day when the next one is staged, and forgetting the first
 * would set the alarm off on the phone that caused it.
 */
const KEEP = 5;

export function useInitiatedChanges() {
  const queryClient = useQueryClient();

  const { data: indexes, isPending } = useQuery({
    queryKey: INITIATED_KEY,
    queryFn: async (): Promise<string[]> => {
      const raw = await AsyncStorage.getItem(INITIATED_STORE);
      if (!raw) return [];
      try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as string[]) : [];
      } catch {
        // A value this device cannot read is one it did not write, and
        // treating it as "I started that" would silence a real alarm.
        return [];
      }
    },
    staleTime: Infinity,
  });

  const write = useMutation({
    mutationFn: async (index: string) => {
      const next = [index, ...(indexes ?? []).filter((i) => i !== index)].slice(
        0,
        KEEP
      );
      await AsyncStorage.setItem(INITIATED_STORE, JSON.stringify(next));
      return next;
    },
    onSuccess: (next) => queryClient.setQueryData(INITIATED_KEY, next),
  });

  return {
    /** Still reading. Nothing should be decided on an unknown answer. */
    isPending,
    startedHere: (index: string) => (indexes ?? []).includes(index),
    /** Called by whichever flow staged the change, as it stages it. */
    recordStarted: (index: string) => write.mutate(index),
  };
}
