import React from "react";
import { View } from "react-native";
import Svg, {
  Defs,
  Ellipse,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import {
  StatusIllustration,
  type StatusScene,
} from "@/components/ui/atoms/StatusIllustration";
import { Typography } from "@/components/ui/atoms/Typography";

/** The illustration's own proportions, 240 by 160. */
const ART_WIDTH = 88;
const CARD_HEIGHT = 90;

/** Each scene's wash, light to deep, so pages read apart as they swipe past. */
const WASH: Record<StatusScene, [string, string, string]> = {
  "empty-account": ["#E3E9ED", "#D3DDE3", "#C3D1D9"],
  earn: ["#E1F1E7", "#CBE6D6", "#B4D9C3"],
  bank: ["#E3E8F7", "#CDD6F0", "#B7C4E8"],
  clock: ["#ECE6F6", "#DCD1EE", "#CABCE5"],
  passkey: ["#F5E6DE", "#EED4C6", "#E5C0AD"],
  payment: ["#E0EFF2", "#C9E3E8", "#B1D5DD"],
  phone: ["#F4E2E6", "#EACCD3", "#DFB5BF"],
};

export interface StatusCardProps {
  /** One line; the card does not wrap it. */
  title: string;
  /** One line; the card does not wrap it. */
  subtitle: string;
  art: StatusScene;
  onPress?: () => void;
}

export function StatusCard({ title, subtitle, art, onPress }: StatusCardProps) {
  const body = (
    <>
      <Wash scene={art} />
      <View className="flex-1 pr-2">
        <Typography
          weight="500"
          className="text-[18px] leading-[23px] tracking-[-0.2px] text-[#0E0F0C]"
          numberOfLines={1}
        >
          {title}
        </Typography>
        <Typography
          weight="500"
          className="mt-0.5 text-[13px] leading-[17px] text-[#0E0F0C]/65"
          numberOfLines={1}
        >
          {subtitle}
        </Typography>
      </View>
      <StatusIllustration scene={art} width={ART_WIDTH} />
    </>
  );

  const className =
    "flex-row items-center overflow-hidden rounded-[20px] pl-5 pr-4";
  const style = { height: CARD_HEIGHT };

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

/** A soft diagonal wash with a bloom of light behind the art. */
function Wash({ scene }: { scene: StatusScene }) {
  const [light, mid, deep] = WASH[scene];
  const id = `wash-${scene}`;
  return (
    <View className="absolute inset-0">
      <Svg
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={light} />
            <Stop offset="0.55" stopColor={mid} />
            <Stop offset="1" stopColor={deep} />
          </LinearGradient>
          <RadialGradient id={`${id}-bloom`} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.75} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100" height="100" fill={`url(#${id})`} />
        <Ellipse cx="76" cy="38" rx="34" ry="70" fill={`url(#${id}-bloom)`} />
      </Svg>
    </View>
  );
}
