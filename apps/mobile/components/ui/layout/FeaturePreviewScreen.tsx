import React, { useEffect } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";

export interface FeatureBenefit {
  icon: keyof typeof Ionicons.glyphMap;
  /** Ionicons takes a colour value rather than a class. */
  iconColor: string;
  title: string;
  description: string;
}

interface FeaturePreviewScreenProps {
  mark: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  benefits: FeatureBenefit[];
  /** Overrides the default "Coming soon" label. */
  footnote?: string;
}

const SCREEN_BLACK = "#0A0A0B";

/**
 * Critically damped: the Consumer tapped a tile, they did not throw anything.
 * Overshoot belongs to motion someone launched with a gesture.
 */
const REVEAL_SPRING = { dampingRatio: 1, duration: 420 } as const;

/** Clears the push transition so the screen arrives before it assembles. */
const REVEAL_BASE_DELAY_MS = 120;
const REVEAL_STAGGER_MS = 45;
const REVEAL_RISE = 14;

/**
 * A full-screen dark preview of something the Consumer cannot use yet.
 *
 * Xend already presents Plus on black in Settings, so unbuilt premium features
 * keep that treatment rather than the white of the working screens: the surface
 * itself signals that this is a look ahead, not a thing to operate.
 *
 * The footer takes the shape of the app's primary button but is inert. It reads
 * as the place the action will be once it exists, without claiming to be one
 * now, so it is not focusable and announces itself as disabled.
 */
export function FeaturePreviewScreen({
  mark,
  title,
  subtitle,
  benefits,
  footnote = "Coming soon",
}: FeaturePreviewScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1" style={{ backgroundColor: SCREEN_BLACK }}>
      {/* Dark to the top edge, so the status bar's own glyphs must invert. */}
      <StatusBar style="light" />

      {/* Fixed rather than scrolling: the whole pitch is one screenful, and a
          scroll indicator on a page with nothing below it invites a swipe that
          goes nowhere. */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: 20,
        }}
      >
        <View className="mb-1 flex-row justify-end">
          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => router.back()}
            className="h-9 w-9 items-center justify-center rounded-full bg-white/10"
          >
            <Ionicons name="close" size={20} color="#FFFFFFB3" />
          </HapticPressable>
        </View>

        <Reveal delay={0} scaleFrom={0.92}>
          <View className="items-center pb-9 pt-2">
            <Bloom mark={mark} />
            <Typography
              weight="700"
              className="mt-6 text-center text-[28px] tracking-[-0.7px] text-white"
            >
              {title}
            </Typography>
            <Typography
              weight="500"
              className="mt-2 max-w-[290px] text-center text-[15px] leading-[140%] text-white/40"
            >
              {subtitle}
            </Typography>
          </View>
        </Reveal>

        <View className="gap-7 rounded-3xl bg-white/[0.04] px-5 py-7">
          {benefits.map((benefit, index) => (
            <Reveal
              key={benefit.title}
              delay={REVEAL_BASE_DELAY_MS + index * REVEAL_STAGGER_MS}
            >
              <View className="flex-row gap-4">
                <View className="w-7 items-center pt-0.5">
                  <Ionicons
                    name={benefit.icon}
                    size={22}
                    color={benefit.iconColor}
                  />
                </View>
                <View className="flex-1 gap-1">
                  <Typography
                    weight="600"
                    className="text-[17px] tracking-[-0.2px] text-white"
                  >
                    {benefit.title}
                  </Typography>
                  <Typography
                    weight="500"
                    className="text-[15px] leading-[140%] text-white/40"
                  >
                    {benefit.description}
                  </Typography>
                </View>
              </View>
            </Reveal>
          ))}
        </View>

        <Reveal
          delay={REVEAL_BASE_DELAY_MS + benefits.length * REVEAL_STAGGER_MS}
        >
          <View
            accessible
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            accessibilityLabel={`${title}, ${footnote}`}
            className="mt-6 items-center rounded-full bg-white/10 py-5"
          >
            <Typography weight="600" className="text-[17px] text-white/50">
              {footnote}
            </Typography>
          </View>
        </Reveal>
      </View>
    </View>
  );
}

/**
 * Fades a block up into place once, on mount.
 *
 * Staggering these is the whole point: the rows arriving in sequence is what
 * makes the screen read as assembling rather than as a slide of static text.
 * Under reduced motion it degrades to the cross-fade alone, which still carries
 * the sequence without the vestibular part.
 */
function Reveal({
  delay,
  scaleFrom,
  children,
}: {
  delay: number;
  /** Scales up into place. Reserved for the hero mark. */
  scaleFrom?: number;
  children: React.ReactNode;
}) {
  const progress = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  const rise = reduceMotion ? 0 : REVEAL_RISE;
  const from = reduceMotion ? 1 : (scaleFrom ?? 1);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      reduceMotion
        ? withTiming(1, { duration: 180 })
        : withSpring(1, REVEAL_SPRING)
    );
  }, [delay, progress, reduceMotion]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * rise },
      { scale: from + (1 - from) * progress.value },
    ],
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * Concentric translucent discs standing in for a radial glow.
 *
 * expo-linear-gradient would render this more directly but it is a native
 * module, and adding one forces a new development build on everyone.
 */
function Bloom({ mark }: { mark: keyof typeof Ionicons.glyphMap }) {
  return (
    <View className="h-[92px] w-[92px] items-center justify-center">
      <View className="absolute h-[92px] w-[92px] rounded-full bg-white/[0.03]" />
      <View className="absolute h-[66px] w-[66px] rounded-full bg-white/[0.05]" />
      <View className="absolute h-[42px] w-[42px] rounded-full bg-white/[0.08]" />
      <Ionicons name={mark} size={32} color="#FFFFFF" />
    </View>
  );
}
