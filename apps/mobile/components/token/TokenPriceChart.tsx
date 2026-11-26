import React from "react";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { usePalette } from "@/hooks/usePalette";

/** The token's price as one line across the width, scaled to its own range. */
export function TokenPriceChart({
  prices,
  height = 180,
}: {
  prices: number[];
  height?: number;
}) {
  const palette = usePalette();
  if (prices.length < 2) {
    return (
      <View className="w-full justify-center" style={{ height }}>
        <View className="h-px w-full bg-foreground/10" />
      </View>
    );
  }
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const span = high - low || 1;
  const path = prices
    .map((price, i) => {
      const x = (i / (prices.length - 1)) * 300;
      const y = 8 + (1 - (price - low) / span) * (height - 16);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <Svg
      width="100%"
      height={height}
      viewBox={`0 0 300 ${height}`}
      preserveAspectRatio="none"
    >
      <Path
        d={path}
        fill="none"
        stroke={palette.foreground}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </Svg>
  );
}
