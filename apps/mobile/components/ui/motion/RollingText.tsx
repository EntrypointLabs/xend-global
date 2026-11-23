import React, { useEffect, useState } from "react";
import { View } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import {
  Typography,
  type TypographyProps,
} from "@/components/ui/atoms/Typography";

import { EASE_OUT, ROLL } from "./tokens";

type RollingTextProps = Omit<TypographyProps, "children"> & {
  text: string;
  /** Characters already rolling in ahead of this run, so two runs read as one figure. */
  startAt?: number;
};

/**
 * A figure whose characters roll into place: all of them when it first
 * appears, and afterwards only the ones that changed.
 */
export function RollingText({
  text,
  startAt = 0,
  ...typography
}: RollingTextProps) {
  const chars = Array.from(text);
  return (
    <View
      className="flex-row"
      accessible
      accessibilityRole="text"
      accessibilityLabel={text}
    >
      {chars.map((char, i) => (
        // Keyed from the right so the units stay the units when the figure
        // gains or loses a digit.
        <RollingChar
          key={chars.length - i}
          char={char}
          order={startAt + i}
          {...typography}
        />
      ))}
    </View>
  );
}

function RollingChar({
  char,
  order,
  ...typography
}: Omit<TypographyProps, "children"> & { char: string; order: number }) {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(char);
  const height = useSharedValue(24);
  // -1 waiting below, 0 in place, 1 gone above.
  const offset = useSharedValue(reduceMotion ? 0 : -1);

  useEffect(() => {
    if (reduceMotion) return;
    offset.value = withDelay(
      order * ROLL.stagger,
      withTiming(0, { duration: ROLL.duration, easing: EASE_OUT })
    );
    // Only the arrival is staggered; `order` is fixed for a mounted character.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (char === shown) return;
    if (reduceMotion) {
      setShown(char);
      return;
    }
    offset.value = withTiming(
      1,
      { duration: ROLL.duration / 2, easing: EASE_OUT },
      (finished) => {
        if (!finished) return;
        runOnJS(setShown)(char);
        offset.value = -1;
        offset.value = withTiming(0, {
          duration: ROLL.duration,
          easing: EASE_OUT,
        });
      }
    );
  }, [char, shown, offset, reduceMotion]);

  const animated = useAnimatedStyle(() => ({
    opacity: 1 - Math.abs(offset.value),
    transform: [{ translateY: -offset.value * height.value * ROLL.travel }],
  }));

  return (
    <Animated.View
      style={animated}
      onLayout={(event) => {
        height.value = event.nativeEvent.layout.height;
      }}
    >
      <Typography {...typography}>{shown}</Typography>
    </Animated.View>
  );
}
