import React, { useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useReducedMotion } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { PRYDD_CARD_BENEFITS } from "@/constants/FeaturePreviews";

export default function PryddCardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { from } = useLocalSearchParams<{ from?: string }>();

  const scroll = useRef<ScrollView>(null);
  const [viewport, setViewport] = useState(0);
  const reduceMotion = useReducedMotion();

  /**
   * The root layout is a Slot rather than a Stack, so going back unmounts the
   * tab navigator and remounts it at its initial route. Returning to the tab
   * that opened this screen therefore has to be explicit.
   */
  const close = () => {
    if (from) {
      router.replace(from as never);
      return;
    }
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)" as never);
  };

  return (
    <View className="flex-1 bg-[#0A0A0B]">
      <StatusBar style="light" />

      <ScrollView
        ref={scroll}
        showsVerticalScrollIndicator={false}
        onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
      >
        {/* The pitch fills exactly one screen; the detail sits below the fold
            and is reached through "Learn more". */}
        <View
          className="px-5"
          style={{
            minHeight: viewport,
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 16,
          }}
        >
          <View className="flex-row justify-end">
            <HapticPressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={close}
              className="h-9 w-9 items-center justify-center rounded-full bg-white/10"
            >
              <Ionicons name="close" size={20} color="#FFFFFFB3" />
            </HapticPressable>
          </View>

          <View className="flex-1 items-center justify-center">
            <CardObject />
          </View>

          <View className="items-center pb-10">
            <Typography
              weight="900"
              accessibilityRole="header"
              className="text-center text-[34px] uppercase leading-[36px] tracking-[-1px] text-white"
            >
              Prydd Card is{"\n"}coming soon
            </Typography>
            <Typography
              weight="500"
              className="mt-4 max-w-[300px] text-center text-[16px] leading-[24px] text-white/60"
            >
              Join the waitlist to be the first to hear when the card is ready.
            </Typography>
          </View>

          {/* Not wired to anything yet: there is no waitlist to join. */}
          <HapticPressable
            accessibilityRole="button"
            className="items-center rounded-full bg-white py-5"
          >
            <Typography weight="600" className="text-[17px] text-black">
              Join the waitlist
            </Typography>
          </HapticPressable>

          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel="Learn more about Prydd Card"
            onPress={() =>
              scroll.current?.scrollTo({ y: viewport, animated: !reduceMotion })
            }
            className="mt-2 items-center py-4"
          >
            <Typography
              weight="600"
              className="text-[16px] text-white underline"
            >
              Learn more
            </Typography>
          </HapticPressable>
        </View>

        <View
          className="gap-7 px-5 pt-6"
          style={{ paddingBottom: insets.bottom + 32 }}
        >
          {PRYDD_CARD_BENEFITS.map((benefit) => (
            <View key={benefit.title} className="flex-row gap-4">
              <View className="w-7 items-center pt-0.5">
                <Ionicons name={benefit.icon} size={22} color="#FFFFFF" />
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
                  className="text-[15px] leading-[21px] text-white/60"
                >
                  {benefit.description}
                </Typography>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * Two cards drawn in views: an outline behind, the paper card in front. Kept
 * to shapes because there is no card artwork yet and no network mark the
 * product is entitled to show.
 */
function CardObject() {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="A Prydd Card"
      className="h-[220px] w-[300px] items-center justify-center"
    >
      <View className="absolute h-[152px] w-[240px] rotate-[10deg] rounded-[18px] border border-white/20 bg-white/[0.04]" />
      <View className="h-[152px] w-[240px] -rotate-[8deg] justify-between rounded-[18px] bg-white p-5">
        <View className="flex-row items-start justify-between">
          <Typography
            weight="800"
            className="text-[20px] tracking-[-0.6px] text-black"
          >
            Prydd
          </Typography>
          <Ionicons
            name="wifi"
            size={18}
            color="#0A0A0B"
            className="rotate-90"
          />
        </View>
        <View className="h-[26px] w-[36px] rounded-[6px] bg-black/15" />
        <View className="flex-row items-center gap-1.5">
          {[0, 1, 2, 3].map((dot) => (
            <View key={dot} className="h-1.5 w-1.5 rounded-full bg-black" />
          ))}
        </View>
      </View>
    </View>
  );
}
