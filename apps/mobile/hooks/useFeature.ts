import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";

import type { FeatureName } from "@/constants/Features";
import { apiClient } from "@/utils/apiClient";
import { isFeatureEnabled, loadServerFeatures } from "@/utils/features";

const FEATURES_KEY = ["features"] as const;

/**
 * Whether a feature is on right now, by the build and the server together.
 *
 * Read once per launch and again when the app returns to the foreground after
 * a minute away. Until the first read finishes, the build's own setting
 * stands, so a feature the server has not touched never flickers.
 */
export function useFeature(name: FeatureName): boolean {
  const { data } = useQuery({
    queryKey: FEATURES_KEY,
    queryFn: () =>
      loadServerFeatures(() => apiClient.getFeatures(), AsyncStorage),
    staleTime: 60_000,
  });
  return isFeatureEnabled(name, data);
}
