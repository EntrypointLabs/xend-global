import React from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";

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

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
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

        <View className="gap-7 rounded-3xl bg-white/[0.04] px-5 py-7">
          {benefits.map((benefit) => (
            <View key={benefit.title} className="flex-row gap-4">
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
          ))}
        </View>

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
      </ScrollView>
    </View>
  );
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
