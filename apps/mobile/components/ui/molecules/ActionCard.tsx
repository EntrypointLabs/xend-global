import React from "react";
import { View, Image, ImageSourcePropType } from "react-native";
import { ThemedText } from "@/components/ui/atoms";
import HapticPressable from "../atoms/HapticPressable";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
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

const CARD_GAP = 16;
const REFERENCE_MIN_HEIGHT = 140;

// Matches Typography's lineHeightMedium / lineHeightNormal. Overriding fontSize
// alone leaves the line box at its unscaled height, which keeps the text block
// the same size on every device and is what stopped the card shrinking at all.
const TITLE_LEADING = 1.3;
const SUBTITLE_LEADING = 1.2;
const REFERENCE_ICON = 40;

export function ActionCard({
  title,
  subtitle,
  icon,
  onPress,
  funded = false,
}: ActionCardProps) {
  // Read per render rather than at module scope: a width captured at import
  // survives rotation and split-screen resizes as a stale value.
  const { width, size, typeSize } = useResponsiveLayout();
  const cardWidth = (width - CARD_GAP * 3) / 2;
  const iconSize = size(REFERENCE_ICON);

  return (
    <HapticPressable
      // MEASURED-LAYOUT
      style={{
        width: cardWidth,
        minHeight: size(REFERENCE_MIN_HEIGHT),
        paddingVertical: size(24),
        marginBottom: size(16),
      }}
      className={cn(
        "justify-between rounded-2xl border bg-card px-4",
        funded
          ? "border-[0.3px] border-solid border-black/[0.12]"
          : "border-dashed border-black/[0.12]"
      )}
      onPress={onPress}
    >
      <Image
        source={icon}
        style={{ width: iconSize, height: iconSize }}
        resizeMode="contain"
      />

      <View className="gap-1">
        <ThemedText
          type="defaultSemiBold"
          style={{
            fontSize: typeSize(16),
            lineHeight: typeSize(16) * TITLE_LEADING,
          }}
        >
          {title}
        </ThemedText>
        <ThemedText
          type="small"
          className="opacity-60"
          style={{
            fontSize: typeSize(13),
            lineHeight: typeSize(13) * SUBTITLE_LEADING,
          }}
        >
          {subtitle}
        </ThemedText>
      </View>
    </HapticPressable>
  );
}
