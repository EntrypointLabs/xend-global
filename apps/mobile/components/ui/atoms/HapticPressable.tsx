import React, { useCallback } from "react";
import { Pressable, PressableProps } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Critically damped, no overshoot. A control returning to rest should settle,
 * not bounce: bounce belongs to motion the Consumer themselves threw.
 */
const SPRING = { dampingRatio: 1, duration: 300 } as const;

const PRESSED_SCALE = 0.97;

export type PressFeedback = "impact" | "selection" | "none";

interface HapticPressableProps extends PressableProps {
  className?: string;
  /**
   * `impact` for committing actions, `selection` for choosing among options
   * (range tabs, keypads), `none` where a parent already gives feedback.
   *
   * Repeating a Medium impact on every tap trains people to stop noticing it,
   * so high-frequency controls should use `selection` or opt out entirely.
   */
  feedback?: PressFeedback;
  /** Opt out of the press-in scale where it would look wrong. */
  scaleOnPress?: boolean;
}

/**
 * The app's pressable.
 *
 * Feedback fires on press **in**, not on release. Waiting for the release to
 * acknowledge a touch is what makes an interface feel dead: the press is the
 * causal event, so it is what the response belongs to.
 */
const HapticPressable = ({
  feedback = "impact",
  scaleOnPress = true,
  disabled,
  onPressIn,
  onPressOut,
  ...props
}: HapticPressableProps) => {
  const scale = useSharedValue(1);
  const reduceMotion = useReducedMotion();

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback<NonNullable<PressableProps["onPressIn"]>>(
    (event) => {
      if (!disabled) {
        if (scaleOnPress && !reduceMotion) {
          scale.value = withSpring(PRESSED_SCALE, SPRING);
        }
        if (feedback === "impact") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } else if (feedback === "selection") {
          Haptics.selectionAsync();
        }
      }
      onPressIn?.(event);
    },
    [disabled, feedback, onPressIn, reduceMotion, scale, scaleOnPress]
  );

  const handlePressOut = useCallback<NonNullable<PressableProps["onPressOut"]>>(
    (event) => {
      scale.value = withSpring(1, SPRING);
      onPressOut?.(event);
    },
    [onPressOut, scale]
  );

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[props.style, scaleOnPress ? animatedStyle : undefined]}
    >
      {props.children}
    </AnimatedPressable>
  );
};

export default HapticPressable;
