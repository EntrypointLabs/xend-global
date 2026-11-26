import React, { useState } from "react";
import Animated, { FadeIn } from "react-native-reanimated";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { GlassButton, GlassSurface } from "@/components/ui/atoms/Glass";
import { Typography } from "@/components/ui/atoms/Typography";
import { usePalette } from "@/hooks/usePalette";
import { cn } from "@/utils/cn";

/** Back on the left, Deposit and Withdraw on the right, floating over the page. */
export function EarnActionBar({
  canWithdraw,
  hidden,
  onDeposit,
  onWithdraw,
}: {
  canWithdraw: boolean;
  /** Off while a sheet is over the page, so it does not show through as the sheet fades. */
  hidden?: boolean;
  onDeposit: () => void;
  onWithdraw: () => void;
}) {
  const router = useRouter();
  const palette = usePalette();
  const [returning, setReturning] = useState(false);
  if (hidden && !returning) setReturning(true);
  if (hidden) return null;
  return (
    // REANIMATED-EXCEPTION: waits out the sheet's fade before coming back.
    <Animated.View
      entering={returning ? FadeIn.delay(250).duration(200) : undefined}
      className="absolute bottom-2 left-5 right-5 flex-row items-center gap-3"
    >
      <GlassButton
        radius={999}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={() => router.back()}
        className="h-14 w-14 items-center justify-center rounded-full"
      >
        <Ionicons name="chevron-back" size={22} color={palette.foreground} />
      </GlassButton>

      <GlassSurface
        radius={999}
        className="ml-auto flex-row items-center gap-6 rounded-full px-6 py-4"
      >
        <HapticPressable
          accessibilityRole="button"
          accessibilityLabel="Deposit into Earn"
          onPress={onDeposit}
          className="flex-row items-center gap-2"
        >
          <Ionicons name="add" size={18} color={palette.foreground} />
          <Typography variant="body" weight="600">
            Deposit
          </Typography>
        </HapticPressable>

        <HapticPressable
          accessibilityRole="button"
          accessibilityLabel="Withdraw from Earn"
          // Disabled rather than hidden: a zero position should still show
          // the Consumer that withdrawing is how they get out.
          disabled={!canWithdraw}
          accessibilityState={{ disabled: !canWithdraw }}
          onPress={onWithdraw}
          className={cn(
            "flex-row items-center gap-2",
            !canWithdraw && "opacity-30"
          )}
        >
          <Ionicons name="arrow-up" size={18} color={palette.foreground} />
          <Typography variant="body" weight="600">
            Withdraw
          </Typography>
        </HapticPressable>
      </GlassSurface>
    </Animated.View>
  );
}
