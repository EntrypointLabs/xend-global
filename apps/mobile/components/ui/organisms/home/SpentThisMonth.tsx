import React, { useState } from "react";
import { LayoutChangeEvent, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { Typography } from "@/components/ui/atoms/Typography";
import { formatMoney } from "@/utils/balances";
import type { MonthlySpend } from "@/utils/spentThisMonth";
import { useOnPhoto, useSurface } from "@/components/ui/glass";
import { cn } from "@/utils/cn";
import { HomeSection } from "./HomeSection";

const PLOT_HEIGHT = 56;
const DOT_RADIUS = 3.5;

function linePath(values: number[], width: number, height: number): string {
  const max = Math.max(...values, 0);
  const inset = DOT_RADIUS + 1;
  const usableHeight = height - inset * 2;
  return values
    .map((value, index) => {
      const x = inset + (index / (values.length - 1)) * (width - inset * 2);
      const y =
        max === 0
          ? height - inset
          : height - inset - (value / max) * usableHeight;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function SpendLine({
  values,
  height = PLOT_HEIGHT,
}: {
  values: number[];
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const onPhoto = useOnPhoto();
  const onLayout = (event: LayoutChangeEvent) =>
    setWidth(event.nativeEvent.layout.width);
  const flat = Math.max(...values) === 0;
  const ink = onPhoto ? "#FFFFFF" : "#000000";
  const faint = onPhoto ? "#FFFFFF1F" : "#0000001A";

  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 && values.length > 1 && (
        <Svg width={width} height={height}>
          <Path
            d={linePath(values, width, height)}
            stroke={flat ? faint : ink}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          {!flat && (
            <Circle
              cx={width - DOT_RADIUS - 1}
              cy={DOT_RADIUS + 1}
              r={DOT_RADIUS}
              fill={ink}
            />
          )}
        </Svg>
      )}
    </View>
  );
}

export function SpentThisMonth({
  spend,
  hidden,
}: {
  spend: MonthlySpend;
  hidden: boolean;
}) {
  const S = useSurface();
  const total = hidden ? "••••" : `$${formatMoney(spend.totalUsd)}`;
  return (
    <HomeSection title="Spent this month">
      <View
        className={cn("p-[18px]", S.card)}
        // PLATFORM-SHADOW
        style={S.raised}
        accessible
        accessibilityLabel={`Spent this month, ${hidden ? "hidden" : total}`}
      >
        <Typography
          weight="500"
          className={cn("text-[28px] leading-[105%] tracking-[-1.26px]", S.ink)}
        >
          {total}
        </Typography>
        <Typography weight="500" className={cn("mt-1.5 text-[13px]", S.small)}>
          Sends and payments
        </Typography>
        <View className="mt-3">
          <SpendLine values={spend.cumulative} />
        </View>
      </View>
    </HomeSection>
  );
}
