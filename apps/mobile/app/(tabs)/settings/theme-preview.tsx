import React, { useRef } from "react";
import {
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import {
  THEME_LABELS,
  useAppearance,
  type AppTheme,
} from "@/contexts/AppearanceContext";
import { cn } from "@/utils/cn";

const THEMES: AppTheme[] = ["monochrome", "colorful"];
const FIELD = require("@/assets/images/auth/life-meets-savings.jpg");

/** Card width as a share of the screen; the next card peeks in beside it. */
const CARD_SHARE = 0.46;
const CARD_ASPECT = 2.15;
const GAP = 16;

/**
 * A full-screen gallery of the themes, each drawn as a small phone. Swiping a
 * theme to the centre applies it, so what is in the middle is what the app is.
 */
export default function ThemePreviewScreen() {
  const { theme, setTheme } = useAppearance();
  const { width } = useWindowDimensions();
  const cardWidth = Math.round(width * CARD_SHARE);
  const cardHeight = Math.round(cardWidth * CARD_ASPECT);
  const step = cardWidth + GAP;
  const side = (width - cardWidth) / 2;
  const scrollRef = useRef<ScrollView>(null);

  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / step);
    const next = THEMES[Math.max(0, Math.min(THEMES.length - 1, index))];
    if (next !== theme) setTheme(next);
  };

  const select = (index: number) => {
    scrollRef.current?.scrollTo({ x: index * step, animated: true });
    if (THEMES[index] !== theme) setTheme(THEMES[index]);
  };

  return (
    <SafeAreaView className="flex-1 bg-black">
      <View className="h-14 flex-row items-center justify-center px-5">
        <HapticPressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          className="absolute left-5 size-11 items-center justify-center rounded-full bg-white/10"
        >
          <Ionicons name="arrow-back" size={20} color="#FFF" />
        </HapticPressable>
        <Typography weight="500" className="text-base text-white">
          Theme preview
        </Typography>
      </View>

      <View className="flex-1 justify-center">
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={step}
          decelerationRate="fast"
          contentOffset={{ x: THEMES.indexOf(theme) * step, y: 0 }}
          // Shrink to the cards so the column can centre them vertically.
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ paddingHorizontal: side, gap: GAP }}
          onMomentumScrollEnd={settle}
        >
          {THEMES.map((value, index) => (
            <HapticPressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ selected: value === theme }}
              accessibilityLabel={THEME_LABELS[value]}
              onPress={() => select(index)}
              className="items-center"
            >
              <PhoneMock theme={value} width={cardWidth} height={cardHeight} />
              <View className="mt-4 flex-row items-center gap-1.5">
                {value === theme && (
                  <Ionicons name="checkmark-circle" size={16} color="#FFF" />
                )}
                <Typography
                  weight="500"
                  className={cn(
                    "text-sm",
                    value === theme ? "text-white" : "text-white/50"
                  )}
                >
                  {THEME_LABELS[value]}
                </Typography>
              </View>
            </HapticPressable>
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

/**
 * Home in miniature: header controls, the balance, the action row and a card,
 * drawn as placeholders so the backdrop and material are what reads.
 */
function PhoneMock({
  theme,
  width,
  height,
}: {
  theme: AppTheme;
  width: number;
  height: number;
}) {
  const colorful = theme === "colorful";
  const shape = colorful ? "bg-white/[0.18]" : "bg-black/[0.07]";
  const ink = colorful ? "text-white" : "text-black";

  return (
    <View
      className={cn(
        "overflow-hidden rounded-[22px] border p-3",
        colorful ? "border-white/[0.18]" : "border-white/20 bg-white"
      )}
      style={{ width, height }}
    >
      {colorful && (
        <>
          <Image
            source={FIELD}
            resizeMode="cover"
            style={StyleSheet.absoluteFill}
          />
          <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="mockVeil" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#000" stopOpacity="0.7" />
                <Stop offset="0.45" stopColor="#000" stopOpacity="0.3" />
                <Stop offset="1" stopColor="#000" stopOpacity="0.7" />
              </LinearGradient>
            </Defs>
            <Rect width={width} height={height} fill="url(#mockVeil)" />
          </Svg>
        </>
      )}

      <View className="flex-row items-center justify-between">
        <View className={cn("size-6 rounded-full", shape)} />
        <View className={cn("h-5 w-14 rounded-full", shape)} />
        <View className={cn("size-6 rounded-full", shape)} />
      </View>

      <View className="mt-10 items-center">
        <Typography weight="500" className={cn("text-[11px] opacity-70", ink)}>
          Total Balance
        </Typography>
        <Typography weight="700" className={cn("mt-1 text-lg", ink)}>
          $3,590.70
        </Typography>
      </View>

      <View className="mt-8 flex-row justify-between px-1">
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            className={cn(
              "size-7 rounded-full",
              i === 0 ? (colorful ? "bg-white" : "bg-black") : shape
            )}
          />
        ))}
      </View>

      <View className="mt-auto gap-2">
        <View
          className={cn(
            "h-16 rounded-xl",
            colorful
              ? "border border-white/[0.18] bg-white/10"
              : "bg-black/[0.05]"
          )}
        />
        <View
          className={cn(
            "h-10 rounded-xl",
            colorful
              ? "border border-white/[0.18] bg-white/10"
              : "bg-black/[0.05]"
          )}
        />
      </View>
    </View>
  );
}
