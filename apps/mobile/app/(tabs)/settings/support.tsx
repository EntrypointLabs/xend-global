import React from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { ScreenLayout } from "@/components/ui/layout";
import {
  SUPPORT_TOPICS,
  SUPPORT_TOPIC_COPY,
  type SupportTopic,
} from "@/utils/support";

const TOPIC_ICON: Record<SupportTopic, keyof typeof Ionicons.glyphMap> = {
  account_access: "key-outline",
  payments: "arrow-up-outline",
  earn_swap: "trending-up-outline",
  other: "chatbubble-outline",
};

/**
 * Contact support, first step: what the message is about.
 *
 * Asked before the message rather than inside it, so a Consumer locked out of
 * their Account is one tap from saying so and the team reads it first.
 */
export default function SupportScreen() {
  return (
    <ScreenLayout>
      <View className="flex-1 px-3">
        <HapticPressable
          onPress={() => router.back()}
          className="size-10 items-center justify-center rounded-full bg-black/[0.08]"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={20} color="#00000066" />
        </HapticPressable>

        <Typography
          weight="700"
          accessibilityRole="header"
          className="mt-10 text-5xl leading-[44px] text-black"
        >
          How can{"\n"}we help?
        </Typography>

        <Typography
          weight="600"
          className="mt-5 text-[15px] leading-6 text-black"
        >
          Pick what your message is about
        </Typography>

        <ScrollView
          className="mt-5 flex-1"
          showsVerticalScrollIndicator={false}
        >
          {SUPPORT_TOPICS.map((topic) => {
            const { label, detail } = SUPPORT_TOPIC_COPY[topic];
            return (
              <HapticPressable
                key={topic}
                accessibilityRole="button"
                accessibilityLabel={`${label}. ${detail}`}
                feedback="selection"
                onPress={() =>
                  router.push({
                    pathname: "/settings/support-message",
                    params: { topic },
                  } as never)
                }
                className="flex-row items-center gap-4 border-b border-black/[0.06] py-4"
              >
                <View className="size-12 items-center justify-center rounded-full border border-black/10">
                  <Ionicons name={TOPIC_ICON[topic]} size={20} color="#000" />
                </View>
                <View className="flex-1 gap-0.5">
                  <Typography weight="600" className="text-base text-black">
                    {label}
                  </Typography>
                  <Typography
                    weight="500"
                    className="text-sm leading-5 text-black/40"
                  >
                    {detail}
                  </Typography>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#00000059" />
              </HapticPressable>
            );
          })}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}
