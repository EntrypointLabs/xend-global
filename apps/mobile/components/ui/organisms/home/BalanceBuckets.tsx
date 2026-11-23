import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { useSurface } from "@/components/ui/glass";
import { cn } from "@/utils/cn";

export interface BalanceBucket {
  key: string;
  label: string;
  /** Already formatted for display. */
  amount: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
}

/** One row per part of the total balance, each opening that part's page. */
export function BalanceBuckets({ buckets }: { buckets: BalanceBucket[] }) {
  const S = useSurface();
  if (buckets.length === 0) return null;

  return (
    // PLATFORM-SHADOW
    <View className={cn("px-4", S.card)} style={S.raised}>
      {buckets.map((bucket, i) => (
        <HapticPressable
          key={bucket.key}
          accessibilityRole="link"
          accessibilityLabel={`${bucket.label}, ${bucket.amount}`}
          onPress={bucket.onPress}
          className={cn(
            "flex-row items-center gap-3 py-3.5",
            i > 0 && cn("border-t", S.divider)
          )}
        >
          <View
            className={cn(
              "size-9 items-center justify-center rounded-full",
              S.chip
            )}
          >
            <Ionicons name={bucket.icon} size={17} color={S.colors.ink} />
          </View>
          <Typography weight="600" className={cn("flex-1 text-[15px]", S.ink)}>
            {bucket.label}
          </Typography>
          <Typography weight="600" className={cn("text-[15px]", S.ink)}>
            {bucket.amount}
          </Typography>
          <Ionicons name="chevron-forward" size={15} color={S.colors.caption} />
        </HapticPressable>
      ))}
    </View>
  );
}
