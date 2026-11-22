import React from "react";
import Svg, { Path } from "react-native-svg";

/**
 * The elbow that hangs off a naira row's badge and points at what the money
 * became. Drawn from the badge's centre line, so it sits flush under a 40pt
 * badge when given that badge's left offset.
 */
export function ConversionArrow({ color }: { color: string }) {
  return (
    <Svg width={38} height={24} viewBox="0 0 38 24" fill="none">
      <Path
        d="M1 0 V5 Q1 12 8 12 H35"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
      />
      <Path
        d="M30 7 L36 12 L30 17"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
