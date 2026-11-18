import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";

import { fetchCountryCard, storedCountryCard } from "@/utils/countryCardLoader";
import type { CountryCard } from "@/utils/countryCards";

/**
 * The country card for where this person is. The last one fetched shows at
 * once; a fresh one replaces it when the network answers, and a failed fetch
 * leaves the remembered card in place.
 */
export function useCountryCard(): CountryCard | null {
  const stored = useQuery({
    queryKey: ["country-card", "stored"],
    queryFn: () => storedCountryCard(AsyncStorage),
    staleTime: Infinity,
  });
  const live = useQuery({
    queryKey: ["country-card", "live"],
    queryFn: () => fetchCountryCard(AsyncStorage),
    staleTime: 60 * 60_000,
    retry: 1,
  });
  if (live.isSuccess) return live.data;
  return stored.data ?? null;
}
