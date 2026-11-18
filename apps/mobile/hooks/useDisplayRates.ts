import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/utils/apiClient";

/** Reference rates move daily; a few minutes of reuse is plenty. */
export function useDisplayRates() {
  return useQuery({
    queryKey: ["display-rates"],
    queryFn: () => apiClient.getDisplayRates(),
    staleTime: 5 * 60_000,
  });
}
