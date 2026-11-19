import React from "react";
import { View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Typography } from "@/components/ui/atoms/Typography";
import { PillButton } from "@/components/ui/kit";
import {
  Illustration,
  type IllustrationName,
} from "@/components/ui/feature/Illustration";
import { FeatureScreen } from "@/components/ui/feature/FeatureScreen";

export interface FeatureBenefit {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}

export interface FeatureIntroProps {
  illustration: IllustrationName;
  /** Set in the hero, in the wordmark face; keep it to a few words. */
  headline: string;
  benefits: FeatureBenefit[];
  /** Absent while the feature is not built: the footer reads Coming soon. */
  cta?: { title: string; onPress: () => void };
}

/** What every feature that is not open yet ends on, so it reads as planned. */
export function ComingSoonButton() {
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel="Coming soon"
      className="h-14 flex-row items-center justify-center gap-2 rounded-full bg-black/[0.05]"
    >
      <Ionicons name="time-outline" size={18} color="#0A0A0A73" />
      <Typography weight="600" className="text-[15px] text-black/45">
        Coming soon
      </Typography>
    </View>
  );
}

/**
 * A feature's own page: one illustration that says what it is, a short
 * headline, and three plain benefits. Modelled on Wise's jar and scheduled
 * transfer pages.
 */
export function FeatureIntro({
  illustration,
  headline,
  benefits,
  cta,
}: FeatureIntroProps) {
  const { width } = useWindowDimensions();
  const art = Math.min(width - 40, 360) * 0.72;

  return (
    <FeatureScreen
      footer={
        cta ? (
          <PillButton title={cta.title} onPress={cta.onPress} />
        ) : (
          <ComingSoonButton />
        )
      }
    >
      <View className="overflow-hidden rounded-[28px] bg-[#F2F2F0] px-6 pb-6 pt-7">
        <Typography
          accessibilityRole="header"
          className="text-[40px] uppercase leading-[38px] tracking-[-1.2px] text-[#0E0F0C]"
          style={{ fontFamily: "Montserrat_900Black" }}
        >
          {headline}
        </Typography>
        <View className="mt-4 items-center">
          <Illustration name={illustration} size={art} />
        </View>
      </View>

      <View className="mt-8 gap-7">
        {benefits.map((benefit) => (
          <View key={benefit.title} className="flex-row gap-4">
            <View className="size-12 items-center justify-center rounded-full border border-black/[0.1]">
              <Ionicons name={benefit.icon} size={22} color="#0E0F0C" />
            </View>
            <View className="flex-1">
              <Typography
                weight="600"
                className="text-[17px] leading-[22px] text-[#0E0F0C]"
              >
                {benefit.title}
              </Typography>
              <Typography
                weight="500"
                className="mt-1 text-[15px] leading-[21px] text-black/55"
              >
                {benefit.body}
              </Typography>
            </View>
          </View>
        ))}
      </View>
    </FeatureScreen>
  );
}
