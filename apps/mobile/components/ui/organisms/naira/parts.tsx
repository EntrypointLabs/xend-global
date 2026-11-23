import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { copyToClipboard } from "@/utils/clipboard";
import { usePalette } from "@/hooks/usePalette";
import { cn } from "@/utils/cn";

/** The bank-details card language shared by every naira surface. */
export function Card({
  children,
  footer = false,
}: {
  children: React.ReactNode;
  footer?: boolean;
}) {
  return (
    <View
      className={cn(
        "overflow-hidden rounded-[28px] border border-foreground/5 bg-card",
        !footer && "p-7"
      )}
    >
      {children}
    </View>
  );
}

export function CardTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <View>
      <Typography weight="600" className="text-[18px] text-foreground">
        {title}
      </Typography>
      <Typography
        weight="500"
        className="mt-1 text-[15px] leading-5 text-foreground/30"
      >
        {subtitle}
      </Typography>
    </View>
  );
}

export function CopyRow({
  label,
  value,
  copyValue,
  copyLabel,
}: {
  label: string;
  value: string;
  copyValue?: string;
  copyLabel: string;
}) {
  const palette = usePalette();
  return (
    <HapticPressable
      feedback="none"
      accessibilityRole="button"
      accessibilityLabel={`Copy ${copyLabel}`}
      onPress={() => void copyToClipboard(copyValue ?? value, copyLabel)}
      className="flex-row items-center justify-between"
    >
      <View className="flex-1 pr-4">
        <Typography weight="500" className="text-[15px] text-foreground/30">
          {label}
        </Typography>
        <Typography
          weight="500"
          className="mt-1 text-[17px] tabular-nums text-foreground"
        >
          {value}
        </Typography>
      </View>
      <Ionicons name="copy-outline" size={18} color={palette.fg(0.3)} />
    </HapticPressable>
  );
}
