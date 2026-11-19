import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { GlassButton } from "../atoms/Glass";
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
      <GlassButton
        radius={999}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack}
        className="h-14 w-14 items-center justify-center rounded-full"
        fallbackClassName="bg-white shadow-md shadow-black/10"
      >
        <Ionicons name="chevron-back" size={22} color="#000" />
      </GlassButton>

      <GlassButton
        radius={999}
        accessibilityRole="button"
        onPress={onAction}
        className="h-14 flex-row items-center gap-2 rounded-full px-6"
        fallbackClassName="bg-white shadow-md shadow-black/10"
      >
        <Ionicons name={actionIcon} size={22} color="#000" />
        <Typography weight="600" className="text-base text-black">
          {actionLabel}
        </Typography>
      </GlassButton>
    </View>
  );
}
