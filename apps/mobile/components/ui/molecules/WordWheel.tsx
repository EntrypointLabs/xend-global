import React, { useEffect } from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  Easing,
  type SharedValue,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { Typography } from "@/components/ui/atoms/Typography";

const ROW_HEIGHT = 64;
const ICON_SPACE = 52;
const HOLD_MS = 1200;
const MOVE_MS = 500;
const MOVE_EASING = Easing.bezier(0.77, 0, 0.175, 1);

const WORDS = [
  { label: "Save", icon: "shield-checkmark", color: "#38BDF8" },
  { label: "Earn", icon: "bar-chart", color: "#F97316" },
  { label: "Spend", icon: "card", color: "#8B5CF6" },
  { label: "Invest", icon: "trending-up", color: "#6366F1" },
  { label: "Pay", icon: "flash", color: "#EF4444" },
] as const;

/** The word the wheel opens on, and the one it freezes on for reduced motion. */
const OPENING_INDEX = 2;

/**
 * Signed circular distance from a row to the centre, in rows. Zero is the
 * active word, negative is above, positive below, and the wrap keeps every
 * row within half the list of the centre so the loop never shows a seam.
 */
function distance(index: number, progress: number): number {
  "worklet";
  const length = WORDS.length;
  let d = (((index + progress) % length) + length) % length;
  if (d > length / 2) d -= length;
  return d;
}

function Row({
  index,
  progress,
}: {
  index: number;
  progress: SharedValue<number>;
}) {
  const word = WORDS[index];

  const rowStyle = useAnimatedStyle(() => {
    const d = distance(index, progress.value);
    return {
      transform: [{ translateY: d * ROW_HEIGHT }],
      // Three words at a time: the active one, and one ghost on each side.
      // The outer pair is fully out by the time it rests, so it only exists
      // mid-turn, fading in as it approaches.
      opacity: interpolate(Math.abs(d), [0, 1, 2], [1, 0.18, 0], "clamp"),
    };
  });

  // The icon belongs to the active word alone, so it fades as the word
  // leaves the centre and the text slides left to close the space.
  const iconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      Math.abs(distance(index, progress.value)),
      [0, 0.5],
      [1, 0],
      "clamp"
    ),
  }));

  const textStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          Math.abs(distance(index, progress.value)),
          [0, 0.6],
          [ICON_SPACE, 0],
          "clamp"
        ),
      },
    ],
  }));

  return (
    <Animated.View
      style={[{ height: ROW_HEIGHT, top: ROW_HEIGHT * 2 }, rowStyle]}
      className="absolute left-0 right-0 flex-row items-center"
    >
      <Animated.View style={iconStyle} className="absolute left-0">
        <Ionicons name={word.icon} size={34} color={word.color} />
      </Animated.View>
      <Animated.View style={textStyle}>
        <Typography weight="500" className="text-4xl">
          {word.label}
        </Typography>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * The slow wheel of what Xend does, for the signed-out front door. Ambient
 * and decorative, so it is hidden from screen readers, and under reduced
 * motion it holds one word instead of turning.
 */
export function WordWheel() {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(WORDS.length - OPENING_INDEX);

  useEffect(() => {
    if (reduceMotion) return;
    const advance = setInterval(() => {
      progress.value = withTiming(progress.value + 1, {
        duration: MOVE_MS,
        easing: MOVE_EASING,
      });
    }, HOLD_MS + MOVE_MS);
    return () => clearInterval(advance);
  }, [reduceMotion, progress]);

  if (reduceMotion) {
    const word = WORDS[OPENING_INDEX];
    return (
      <View
        style={{ height: ROW_HEIGHT }}
        className="flex-row items-center gap-4"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <Ionicons name={word.icon} size={34} color={word.color} />
        <Typography weight="500" className="text-4xl">
          {word.label}
        </Typography>
      </View>
    );
  }

  return (
    <View
      style={{ height: ROW_HEIGHT * 5 }}
      className="overflow-hidden"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {WORDS.map((word, index) => (
        <Row key={word.label} index={index} progress={progress} />
      ))}
    </View>
  );
}
