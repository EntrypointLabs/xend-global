import React, { useEffect } from "react";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { POP } from "./tokens";

const HAPTIC = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
} as const;

/**
 * The mark of a finished action (a tick, a cross, the error illustration)
 * springing in as its screen appears, with the matching haptic. The words
 * under it follow with `Rise`.
 */
export function Pop({
  haptic = "none",
  children,
}: {
  /** `none` where the screen already fires its own. */
  haptic?: keyof typeof HAPTIC | "none";
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(reduceMotion ? 1 : POP.fromScale);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (haptic !== "none") void Haptics.notificationAsync(HAPTIC[haptic]);
    // Fired once for the arrival, not again if the tone prop is recomputed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: POP.fadeMs });
    if (!reduceMotion) scale.value = withSpring(1, POP.spring);
  }, [opacity, reduceMotion, scale]);

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return <Animated.View style={animated}>{children}</Animated.View>;
}
