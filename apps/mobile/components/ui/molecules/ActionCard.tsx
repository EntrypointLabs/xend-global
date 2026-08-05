import React from "react";
import { View, Dimensions, Image, ImageSourcePropType } from "react-native";
import { ThemedText } from "@/components/ui/atoms";
import HapticPressable from "../atoms/HapticPressable";
import { cn } from "@/utils/cn";

interface ActionCardProps {
  title: string;
  subtitle: string;
  icon: ImageSourcePropType;
  onPress: () => void;
  iconColor?: string;
  iconBackgroundColor?: string;
  /**
   * Whether this section holds anything. A dashed edge reads as an outline
   * waiting to be filled; once there is a balance behind it the card is real,
   * so the border closes up.
   */
  funded?: boolean;
}

const { width } = Dimensions.get("window");
const CARD_GAP = 16;
const CARD_WIDTH = (width - CARD_GAP * 3) / 2;

export function ActionCard({
  title,
  subtitle,
  icon,
  onPress,
  funded = false,
}: ActionCardProps) {
  return (
    <HapticPressable
      // MEASURED-LAYOUT
      style={{ width: CARD_WIDTH }}
      className={cn(
        "mb-4 min-h-[140px] justify-between gap-10 rounded-2xl border bg-card px-4 py-6",
        funded
          ? "border-[0.3px] border-solid border-black/[0.12]"
          : "border-dashed border-black/[0.12]"
      )}
      onPress={onPress}
    >
      <Image source={icon} className="size-10" resizeMode="contain" />

      <View className="gap-1">
        <ThemedText type="defaultSemiBold" className="text-base">
          {title}
        </ThemedText>
        <ThemedText type="small" className="text-[13px] opacity-60">
          {subtitle}
        </ThemedText>
      </View>
    </HapticPressable>
  );
}
