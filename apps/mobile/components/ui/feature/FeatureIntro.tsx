import React from "react";
import { View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Typography } from "@/components/ui/atoms/Typography";
import { PillButton } from "@/components/ui/kit";
import { usePalette } from "@/hooks/usePalette";
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
  cta?: { title: string; onPress: () => void; loading?: boolean };
  /**
   * What the page is waiting on, in place of an action: the footer keeps the
   * button's shape and says when, without offering anything to press.
   */
  waiting?: string;
}

/** What every feature that is not open yet ends on, so it reads as planned. */
export function ComingSoonButton() {
  return <WaitingPill label="Coming soon" />;
}

/**
 * The footer's button shape with nothing to press. `informative` is for a
 * label the Consumer came to read, such as a time: it is set darker than the
 * placeholder, which only has to be recognised.
 */
export function WaitingPill({
  label,
  informative = false,
}: {
  label: string;
  informative?: boolean;
}) {
  const palette = usePalette();
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      className="h-14 flex-row items-center justify-center gap-2 rounded-full bg-foreground/[0.05]"
    >
      <Ionicons
        name="time-outline"
        size={18}
        color={palette.fg(informative ? 0.7 : 0.45)}
      />
      <Typography
        weight="600"
        className={
          informative
            ? "text-[15px] text-foreground/70"
            : "text-[15px] text-foreground/45"
        }
      >
        {label}
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
  waiting,
}: FeatureIntroProps) {
  const { width } = useWindowDimensions();
  const palette = usePalette();
  const art = Math.min(width - 40, 360) * 0.72;

  return (
    <FeatureScreen
      footer={
        waiting ? (
          <WaitingPill label={waiting} informative />
        ) : cta ? (
          <PillButton
            title={cta.title}
            onPress={cta.onPress}
            loading={cta.loading}
          />
        ) : (
          <ComingSoonButton />
        )
      }
    >
      <View className="overflow-hidden rounded-[28px] bg-muted px-6 pb-6 pt-7">
        <Typography
          accessibilityRole="header"
          className="text-[40px] uppercase leading-[38px] tracking-[-1.2px] text-ink"
          style={{ fontFamily: "Montserrat_900Black" }}
        >
          {headline}
        </Typography>
        <View className="mt-4 items-center">
          <Illustration name={illustration} size={art} />
        </View>
      </View>

      <View className="mt-7 gap-6">
        {benefits.map((benefit) => (
          <View key={benefit.title} className="flex-row gap-3.5">
            <View className="size-10 items-center justify-center rounded-full border border-foreground/[0.1]">
              <Ionicons name={benefit.icon} size={19} color={palette.ink} />
            </View>
            <View className="flex-1">
              <Typography
                weight="600"
                className="text-[15px] leading-[20px] text-ink"
              >
                {benefit.title}
              </Typography>
              <Typography
                weight="500"
                className="mt-0.5 text-[13px] leading-[18px] text-foreground/50"
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
