import React, { useState } from "react";
import { LayoutChangeEvent, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { Typography } from "@/components/ui/atoms/Typography";
import { formatMoney } from "@/utils/balances";
import type { MonthlySpend } from "@/utils/spentThisMonth";
import { HomeSection } from "./HomeSection";
import { RAISED } from "./surface";

const PLOT_HEIGHT = 56;
const DOT_RADIUS = 3.5;

function linePath(values: number[], width: number): string {
  const max = Math.max(...values, 0);
  const inset = DOT_RADIUS + 1;
  const usableHeight = PLOT_HEIGHT - inset * 2;
  return values
    .map((value, index) => {
      const x = inset + (index / (values.length - 1)) * (width - inset * 2);
      const y =
        max === 0
          ? PLOT_HEIGHT - inset
          : PLOT_HEIGHT - inset - (value / max) * usableHeight;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function Plot({ values }: { values: number[] }) {
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) =>
    setWidth(event.nativeEvent.layout.width);
  const flat = Math.max(...values) === 0;

  return (
    <View onLayout={onLayout} style={{ height: PLOT_HEIGHT }}>
      {width > 0 && values.length > 1 && (
        <Svg width={width} height={PLOT_HEIGHT}>
          <Path
            d={linePath(values, width)}
            stroke={flat ? "#0000001A" : "#000000"}
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
              fill="#000000"
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
  const total = hidden ? "••••" : `$${formatMoney(spend.totalUsd)}`;
  return (
    <HomeSection title="Spent this month">
      <View
        className="rounded-2xl bg-card px-4 py-4"
        accessible
        accessibilityLabel={`Spent this month, ${hidden ? "hidden" : total}`}
        // PLATFORM-SHADOW
        style={RAISED}
      >
        <Typography weight="700" className="text-2xl tracking-[-0.5px]">
          {total}
        </Typography>
        <Typography weight="500" className="mt-0.5 text-[13px] text-black/40">
          Sends and payments
        </Typography>
        <View className="mt-3">
          <Plot values={spend.cumulative} />
        </View>
      </View>
    </HomeSection>
  );
}
