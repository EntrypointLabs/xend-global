import React from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";

import HapticPressable from "@/components/ui/atoms/HapticPressable";

/** Pushed over Home: back arrow for a step inside a flow, a cross to leave it. */
export type FeatureLeave = "back" | "close";

/**
 * The full-screen sheet every feature page sits in: a round back or close
 * button, scrolling content, and an optional footer pinned above the home
 * indicator. It is pushed onto the root stack, so swiping from the edge goes
 * back exactly as the button does.
 */
export function FeatureScreen({
  leave = "back",
  footer,
  scroll = true,
  children,
}: {
  leave?: FeatureLeave;
  footer?: React.ReactNode;
  scroll?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const goBack = () =>
    router.canGoBack() ? router.back() : router.replace("/(tabs)");

  const body = scroll ? (
    <ScrollView
      className="flex-1"
      contentContainerClassName="px-5 pb-8"
      showsVerticalScrollIndicator={false}
      // A tap on a control while the keyboard is up should reach it, not
      // only dismiss the keyboard: the currency chip must open in one tap.
      keyboardShouldPersistTaps="handled"
      // A drag down the page puts the keyboard away, as in Messages.
      keyboardDismissMode="on-drag"
    >
      {children}
    </ScrollView>
  ) : (
    <View className="flex-1 px-5">{children}</View>
  );

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top + 8 }}>
      {/* Always white, whatever the system theme sets the bar to. */}
      <StatusBar style="dark" />
      <View className="px-5 pb-4">
        <HapticPressable
          accessibilityRole="button"
          accessibilityLabel={leave === "close" ? "Close" : "Back"}
          onPress={goBack}
          className="size-11 items-center justify-center rounded-full border border-black/[0.08] bg-white"
          // PLATFORM-SHADOW
          style={{
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.06,
            shadowRadius: 6,
          }}
        >
          <Ionicons
            name={leave === "close" ? "close" : "arrow-back"}
            size={22}
            color="#0A0A0A"
          />
        </HapticPressable>
      </View>
      {body}
      {footer ? (
        <View
          className="border-t border-black/[0.06] px-5 pt-4"
          style={{ paddingBottom: insets.bottom + 12 }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}
