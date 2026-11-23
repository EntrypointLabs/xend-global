import React, { useEffect } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { EASE_OUT, RISE } from "./tokens";

const FILL: ViewStyle = { flex: 1 };

/**
 * A block that fades up into place when its screen appears. Give each block
 * the next `index` and they arrive one after another, top to bottom.
 *
 * Placed by `style` alone: NativeWind's `className` and a Reanimated style
 * cannot share a view. Put classes on the child, and pass `fill` where the
 * child needs the remaining height.
 */
export function Rise({
  index = 0,
  fill = false,
  style,
  children,
}: {
  index?: number;
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = reduceMotion
      ? withTiming(1, { duration: 200 })
      : withDelay(
          index * RISE.stagger,
          withTiming(1, { duration: RISE.duration, easing: EASE_OUT })
        );
  }, [index, progress, reduceMotion]);

  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: reduceMotion
      ? []
      : [{ translateY: (1 - progress.value) * RISE.distance }],
  }));

  return (
    <Animated.View style={[fill ? FILL : undefined, style, animated]}>
      {children}
    </Animated.View>
  );
}
