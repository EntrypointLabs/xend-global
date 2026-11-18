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

import { EmptyAccountIllustration } from "@/components/ui/atoms/EmptyAccountIllustration";
import { Typography } from "@/components/ui/atoms/Typography";

/** The illustration's own proportions, 240 by 160. */
const ART_WIDTH = 88;

/**
 * What Home shows an Account that holds nothing: a banner in the same family
 * as the country card rather than an empty page. It is a state, not a notice,
 * so it cannot be dismissed; it goes once money arrives.
 */
export function EmptyAccountBanner({ subtitle }: { subtitle: string }) {
  return (
    <View
      accessible
      accessibilityLabel={`No activity yet. ${subtitle}`}
      className="flex-row items-center overflow-hidden rounded-[20px] py-[14px] pl-5 pr-4"
    >
      <Mist />
      <View className="flex-1 pr-2">
        <Typography
          weight="500"
          className="text-[18px] leading-[23px] tracking-[-0.2px] text-[#0E0F0C]"
        >
          No activity yet
        </Typography>
        <Typography
          weight="500"
          className="mt-0.5 text-[13px] leading-[17px] text-[#0E0F0C]/65"
          numberOfLines={2}
        >
          {subtitle}
        </Typography>
      </View>
      <EmptyAccountIllustration width={ART_WIDTH} />
    </View>
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
