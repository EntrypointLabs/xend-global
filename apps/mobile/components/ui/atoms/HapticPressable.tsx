import React, { useCallback, useMemo, useRef } from "react";
import {
  Animated,
  Pressable,
  PressableProps,
  StyleProp,
  ViewStyle,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

/**
 * Deliberately React Native's own Animated rather than Reanimated.
 *
 * NativeWind resolves `className` into the same `style` prop that a Reanimated
 * animated style occupies, and merging the two wraps the shared value in
 * another shared value. Reanimated's `isAnimated` then walks `.value.value.…`
 * forever and the stack overflows the moment a screen full of these mounts.
 * A plain Animated.Value is inert to that walk.
 */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Critically damped (damping = 2√(stiffness × mass)), so a control returning to
 * rest settles instead of bouncing: bounce belongs to motion the Consumer
 * themselves threw.
 */
const SPRING = {
  stiffness: 200,
  damping: 28.3,
  mass: 1,
  useNativeDriver: true,
};

const PRESSED_SCALE = 0.97;

export type PressFeedback = "impact" | "selection" | "none";

/**
 * `style` narrows Pressable's own type: the `(state) => style` form cannot be
 * composed with the animated transform, and nothing here passes it.
 */
interface HapticPressableProps extends Omit<PressableProps, "style"> {
  className?: string;
  style?: StyleProp<ViewStyle>;
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
  style,
  ...props
}: HapticPressableProps) => {
  const scale = useRef(new Animated.Value(1)).current;
  const reduceMotion = useReducedMotion();

  const springTo = useCallback(
    (toValue: number) => {
      Animated.spring(scale, { ...SPRING, toValue }).start();
    },
    [scale]
  );

  const handlePressIn = useCallback<NonNullable<PressableProps["onPressIn"]>>(
    (event) => {
      if (!disabled) {
        if (scaleOnPress && !reduceMotion) {
          springTo(PRESSED_SCALE);
        }
        if (feedback === "impact") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } else if (feedback === "selection") {
          Haptics.selectionAsync();
        }
      }
      onPressIn?.(event);
    },
    [disabled, feedback, onPressIn, reduceMotion, scaleOnPress, springTo]
  );

  const handlePressOut = useCallback<NonNullable<PressableProps["onPressOut"]>>(
    (event) => {
      springTo(1);
      onPressOut?.(event);
    },
    [onPressOut, springTo]
  );

  const scaleStyle = useMemo(() => ({ transform: [{ scale }] }), [scale]);

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, scaleOnPress ? scaleStyle : undefined]}
    >
      {props.children}
    </AnimatedPressable>
  );
};

export default HapticPressable;
