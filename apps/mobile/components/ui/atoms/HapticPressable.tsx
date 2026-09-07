import React, { useCallback, useMemo, useRef } from "react";
import {
  Animated,
  Easing,
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
 * The press is acknowledgement, not choreography, so it does not animate: the
 * control is at its pressed size on the very next frame the display draws.
 *
 * This was a critically damped spring (stiffness 200, damping 28.3). Even
 * settling without a bounce, a spring spends most of its life covering the last
 * few percent of the travel — here a few thousandths of a scale unit, on an
 * icon a finger is covering. Nobody can see that part, and waiting for it is
 * what a press must never do.
 *
 * Ten milliseconds is under one frame at 120Hz and under one at 60Hz, so both
 * ends of the press round to "the next frame". It is written as a duration
 * rather than 0 because that is the intent: as fast as a display can answer.
 */
const PRESS_IN_MS = 10;
/**
 * The release is allowed to be seen. It is the half nobody is waiting on — the
 * finger has already left and the action has already fired — and snapping it
 * back makes a deliberate press read as a twitch.
 */
const PRESS_OUT_MS = 120;

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

  const scaleTo = useCallback(
    (toValue: number, duration: number) => {
      Animated.timing(scale, {
        toValue,
        duration,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    },
    [scale]
  );

  const handlePressIn = useCallback<NonNullable<PressableProps["onPressIn"]>>(
    (event) => {
      if (!disabled) {
        if (scaleOnPress && !reduceMotion) {
          scaleTo(PRESSED_SCALE, PRESS_IN_MS);
        }
        if (feedback === "impact") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } else if (feedback === "selection") {
          Haptics.selectionAsync();
        }
      }
      onPressIn?.(event);
    },
    [disabled, feedback, onPressIn, reduceMotion, scaleOnPress, scaleTo]
  );

  const handlePressOut = useCallback<NonNullable<PressableProps["onPressOut"]>>(
    (event) => {
      scaleTo(1, PRESS_OUT_MS);
      onPressOut?.(event);
    },
    [onPressOut, scaleTo]
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
