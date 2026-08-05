import React, { useMemo, useState } from "react";
import { View } from "react-native";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { cn } from "@/utils/cn";

export const CHART_RANGES = ["1D", "1W", "1M", "6M", "1Y"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

const BAR_COUNT = 44;

export interface BalancePoint {
  /** Milliseconds since epoch. */
  at: number;
  /** Balance in display units at that moment. */
  value: number;
}

interface BalanceChartProps {
  /** Oldest first. Fewer than two points renders the flat resting state. */
  history: BalancePoint[];
  className?: string;
}

/**
 * Balance over time, as a bar column per bucket.
 *
 * Only shown once the Consumer has a balance; the zero case gets a call to
 * action instead, because a chart of nothing is noise.
 *
 * With fewer than two points there is no shape to draw, so every bar renders at
 * a uniform resting height rather than inventing a trend. That is a real state,
 * not a skeleton: a wallet funded an hour ago genuinely has no history yet.
 */
export function BalanceChart({ history, className }: BalanceChartProps) {
  const [range, setRange] = useState<ChartRange>("1D");
  // Stable per mount: calling Date.now() inside the memo is an impure render.
  const [now] = useState(() => Date.now());

  const bars = useMemo(() => {
    const cutoff = now - RANGE_MS[range];
    const windowed = history.filter((p) => p.at >= cutoff);
    if (windowed.length < 2) return null;

    const values = bucket(windowed, BAR_COUNT);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min;

    // A flat balance would divide by zero; render it as a level mid-height line.
    if (span === 0) return values.map(() => 0.5);
    return values.map((v) => 0.15 + ((v - min) / span) * 0.85);
  }, [history, range, now]);

  return (
    <View className={className}>
      <View className="h-20 flex-row items-end justify-between">
        {(bars ?? Array.from({ length: BAR_COUNT }, () => null)).map(
          (height, i) => (
            <View
              key={i}
              className="flex-1 rounded-full bg-black/10"
              style={{
                height: height === null ? "100%" : `${height * 100}%`,
                marginHorizontal: 1,
              }}
            />
          )
        )}
      </View>

      <View className="mt-4 flex-row items-center justify-center gap-2">
        {CHART_RANGES.map((option) => {
          const active = option === range;
          return (
            <HapticPressable
              key={option}
              accessibilityRole="button"
              accessibilityLabel={`Show ${option} balance history`}
              accessibilityState={{ selected: active }}
              onPress={() => setRange(option)}
              className={cn(
                "rounded-full px-4 py-2",
                active ? "bg-black/5" : "bg-transparent"
              )}
            >
              <Typography
                weight={active ? "600" : "500"}
                className={cn("text-sm", active ? "" : "text-black/30")}
              >
                {option}
              </Typography>
            </HapticPressable>
          );
        })}
      </View>
    </View>
  );
}

const RANGE_MS: Record<ChartRange, number> = {
  "1D": 24 * 60 * 60 * 1000,
  "1W": 7 * 24 * 60 * 60 * 1000,
  "1M": 30 * 24 * 60 * 60 * 1000,
  "6M": 182 * 24 * 60 * 60 * 1000,
  "1Y": 365 * 24 * 60 * 60 * 1000,
};

/**
 * Reduces points to a fixed number of columns, carrying the last known value
 * through empty buckets so a quiet stretch reads as flat rather than as zero.
 */
function bucket(points: BalancePoint[], count: number): number[] {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const span = Math.max(last.at - first.at, 1);
  const out: number[] = [];
  let carried = first.value;
  let cursor = 0;

  for (let i = 0; i < count; i++) {
    const edge = first.at + (span * (i + 1)) / count;
    while (cursor < points.length && points[cursor]!.at <= edge) {
      carried = points[cursor]!.value;
      cursor++;
    }
    out.push(carried);
  }
  return out;
}
