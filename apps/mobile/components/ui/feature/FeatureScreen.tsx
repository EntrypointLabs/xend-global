import React from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";

import { GlassButton } from "@/components/ui/atoms/Glass";
import { usePalette } from "@/hooks/usePalette";

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
  avoidKeyboard = false,
  children,
}: {
  leave?: FeatureLeave;
  footer?: React.ReactNode;
  scroll?: boolean;
  /** Lifts the footer above the keyboard, for pages typed into. */
  avoidKeyboard?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const palette = usePalette();
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
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top + 8 }}
    >
      <StatusBar style="auto" />
      <View className="px-5 pb-4">
        <GlassButton
          radius={999}
          accessibilityRole="button"
          accessibilityLabel={leave === "close" ? "Close" : "Back"}
          onPress={goBack}
          className="size-11 items-center justify-center rounded-full"
          fallbackClassName="border border-foreground/[0.08] bg-card"
        >
          <Ionicons
            name={leave === "close" ? "close" : "arrow-back"}
            size={22}
            color={palette.dark ? palette.foreground : "#0A0A0A"}
          />
        </GlassButton>
      </View>
      <KeyboardAvoidingView
        className="flex-1"
        enabled={avoidKeyboard}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        // The footer already clears the home indicator; over the keyboard
        // that inset would show as a gap.
        keyboardVerticalOffset={-insets.bottom}
      >
        {body}
        {footer ? (
          <View
            className="px-5 pt-4"
            style={{ paddingBottom: insets.bottom + 12 }}
          >
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}
