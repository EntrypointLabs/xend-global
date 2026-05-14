import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import HapticPressable from "../atoms/HapticPressable";
import { Typography } from "../atoms/Typography";

interface ScreenActionFooterProps {
  onBack: () => void;
  actionLabel: string;
  onAction: () => void;
  actionIcon?: keyof typeof Ionicons.glyphMap;
}

export function ScreenActionFooter({
  onBack,
  actionLabel,
  onAction,
  actionIcon = "add",
}: ScreenActionFooterProps) {
  return (
    <View className="flex-row items-center justify-between">
      <HapticPressable
        onPress={onBack}
        className="h-14 w-14 items-center justify-center rounded-full bg-white shadow-md shadow-black/10"
      >
        <Ionicons name="chevron-back" size={22} color="#000" />
      </HapticPressable>

      <HapticPressable
        onPress={onAction}
        className="h-14 flex-row items-center gap-2 rounded-full bg-white px-6 shadow-md shadow-black/10"
      >
        <Ionicons name={actionIcon} size={22} color="#000" />
        <Typography weight="600" className="text-base text-black">
          {actionLabel}
        </Typography>
      </HapticPressable>
    </View>
  );
}
