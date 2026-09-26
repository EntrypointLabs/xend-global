import React from "react";
import { ActivityIndicator } from "react-native";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { cn } from "@/utils/cn";

/**
 * The light-canvas call to action. `solid` is the one black button a screen
 * gets; `quiet` is everything else. `size="sm"` is the inline `h-11` action
 * used inside cards (retry, check status).
 */
export function PillButton({
  title,
  onPress,
  tone = "solid",
  size = "md",
  disabled = false,
  loading = false,
  className,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  tone?: "solid" | "quiet";
  size?: "md" | "sm";
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  accessibilityLabel?: string;
}) {
  const solid = tone === "solid";
  const inactive = disabled || loading;
  return (
    <HapticPressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      className={cn(
        "flex-row items-center justify-center gap-2 rounded-full",
        size === "md" ? "h-14 px-6" : "h-11 self-start px-5",
        solid ? "bg-black" : "bg-black/5",
        disabled && !loading && "opacity-30",
        className
      )}
    >
      {loading ? (
        <ActivityIndicator size="small" color={solid ? "white" : "black"} />
      ) : null}
      <Typography
        weight="600"
        className={cn(
          size === "md" ? "text-[15px]" : "text-[13px]",
          solid ? "text-white" : "text-black"
        )}
      >
        {title}
      </Typography>
    </HapticPressable>
  );
}
