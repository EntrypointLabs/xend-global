import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, {
  Defs,
  Ellipse,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { EmptyAccountIllustration } from "@/components/ui/atoms/EmptyAccountIllustration";
import { Typography } from "@/components/ui/atoms/Typography";

/** The illustration's own proportions, 240 by 160. */
const ART_WIDTH = 88;
/** The carousel stretches every page to its tallest, so this is a floor. */
const MIN_HEIGHT = 90;
const INK = "#0E0F0C";

export type StatusArt =
  | { kind: "empty-account" }
  | { kind: "icon"; name: keyof typeof Ionicons.glyphMap };

export interface StatusCardProps {
  title: string;
  subtitle: string;
  art: StatusArt;
  onPress?: () => void;
}

export function StatusCard({ title, subtitle, art, onPress }: StatusCardProps) {
  const body = (
    <>
      <Mist />
      <View className="flex-1 pr-2">
        <Typography
          weight="500"
          className="text-[18px] leading-[23px] tracking-[-0.2px] text-[#0E0F0C]"
          numberOfLines={2}
        >
          {title}
        </Typography>
        <Typography
          weight="500"
          className="mt-0.5 text-[13px] leading-[17px] text-[#0E0F0C]/65"
          numberOfLines={2}
        >
          {subtitle}
        </Typography>
      </View>
      <View
        className="items-center justify-center"
        style={{ width: ART_WIDTH }}
      >
        {art.kind === "empty-account" ? (
          <EmptyAccountIllustration width={ART_WIDTH} />
        ) : (
          <View className="size-[52px] items-center justify-center rounded-full bg-white/70">
            <Ionicons name={art.name} size={24} color={INK} />
          </View>
        )}
      </View>
    </>
  );

  const className =
    "flex-1 flex-row items-center overflow-hidden rounded-[20px] py-[14px] pl-5 pr-4";
  const style = { minHeight: MIN_HEIGHT };

  if (!onPress) {
    return (
      <View
        accessible
        accessibilityLabel={`${title}. ${subtitle}`}
        className={className}
        style={style}
      >
        {body}
      </View>
    );
  }
  return (
    <HapticPressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={onPress}
      className={className}
      style={style}
    >
      {body}
    </HapticPressable>
  );
}

/** Cool grey with a soft bloom of light behind the art. */
function Mist() {
  return (
    <View className="absolute inset-0">
      <Svg
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        <Defs>
          <LinearGradient id="mist" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#E3E9ED" />
            <Stop offset="0.55" stopColor="#D3DDE3" />
            <Stop offset="1" stopColor="#C3D1D9" />
          </LinearGradient>
          <RadialGradient id="bloom" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.75} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100" height="100" fill="url(#mist)" />
        <Ellipse cx="76" cy="38" rx="34" ry="70" fill="url(#bloom)" />
      </Svg>
    </View>
  );
}
