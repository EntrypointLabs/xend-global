import React from "react";
import { View } from "react-native";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";

interface HomeSectionProps {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}

/** The muted heading with an optional link on the right that Home sections share. */
export function HomeSection({
  title,
  actionLabel,
  onAction,
  children,
}: HomeSectionProps) {
  return (
    <View>
      <View className="flex-row items-center justify-between pb-1">
        <Typography weight="500" className="text-sm text-black/30">
          {title}
        </Typography>
        {actionLabel && onAction && (
          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel={`${actionLabel}, ${title}`}
            hitSlop={12}
            onPress={onAction}
            className="py-1"
          >
            <Typography weight="500" className="text-sm text-black/40">
              {actionLabel}
            </Typography>
          </HapticPressable>
        )}
      </View>
      <View className="pt-1">{children}</View>
    </View>
  );
}
