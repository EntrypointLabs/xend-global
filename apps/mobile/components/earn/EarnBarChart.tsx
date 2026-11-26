import React from "react";
import Svg, { Rect } from "react-native-svg";

import { usePalette } from "@/hooks/usePalette";

/**
 * Rounded bars, faint except the last, which is solid: the chart on the
 * product sheet, shared so the position page draws the same thing.
 */
export function EarnBarChart({
  values,
  height = 108,
}: {
  values: number[];
  height?: number;
}) {
  const palette = usePalette();
  const peak = Math.max(...values, 0);
  const slot = 300 / values.length;
  // Never wider than the sheet's twelve-bar chart, so seven days read the same.
  const width = Math.min(slot * 0.76, 19);
  return (
    <Svg
      width="100%"
      height={height}
      viewBox={`0 0 300 ${height}`}
      preserveAspectRatio="none"
    >
      {values.map((value, i) => {
        const barHeight = 8 + (peak > 0 ? (value / peak) * (height - 20) : 0);
        return (
          <Rect
            key={i}
            x={i * slot + (slot - width) / 2}
            y={height - 4 - barHeight}
            width={width}
            height={barHeight}
            rx={Math.min(6, width / 2)}
            fill={palette.primary}
            opacity={i === values.length - 1 ? 1 : 0.08}
          />
        );
      })}
    </Svg>
  );
}
