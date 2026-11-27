import { GlassButton } from "@/components/ui/atoms/Glass";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  View,
} from "react-native";
import Constants from "expo-constants";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { ScreenLayout } from "@/components/ui/layout";
import {
  MESSAGE_SCREEN_INSET,
  MessageField,
} from "@/components/ui/molecules/MessageField";
import { useToast } from "@/contexts/ToastContext";
import { apiClient, apiErrorCode } from "@/utils/apiClient";
import { cn } from "@/utils/cn";
import { usePalette } from "@/hooks/usePalette";

export default function FeedbackScreen() {
  const palette = usePalette();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = message.trim();
  const canSend = trimmed.length > 0 && !busy;

  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.shareFeedback({
        message: trimmed,
        appVersion: Constants.expoConfig?.version,
        platform: Platform.OS === "ios" ? "ios" : "android",
      });
    } catch (err) {
      setBusy(false);
      setError(
        apiErrorCode(err) === "FEEDBACK_RATE_LIMITED"
          ? "That's plenty for today, thank you. Try again tomorrow."
          : "Couldn't send your feedback. Try again."
      );
      return;
    }
    showToast("Thanks for the feedback");
    router.back();
  };

  return (
    <ScreenLayout>
      <KeyboardAvoidingView
        className="flex-1 px-3"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top + MESSAGE_SCREEN_INSET}
      >
        <GlassButton
          radius={999}
          onPress={() => router.back()}
          className="size-10 items-center justify-center rounded-full"
          fallbackClassName="border border-foreground/[0.08] bg-card"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={20} color={palette.foreground} />
        </GlassButton>

        <Typography
          weight="700"
          accessibilityRole="header"
          className="mt-6 text-3xl text-foreground"
        >
          Share your feedback
        </Typography>

        <Typography
          weight="500"
          className="mt-3 text-[15px] leading-6 text-foreground/40"
        >
          Tell us what to change, fix or keep
        </Typography>

        <View className="mt-5 shrink">
          <MessageField
            value={message}
            onChangeText={(text) => {
              setMessage(text);
              setError(null);
            }}
            placeholder="Write your feedback"
            accessibilityLabel="Your feedback"
            editable={!busy}
          />
        </View>

        <View className="mt-4 flex-row gap-2">
          <Ionicons
            name="information-circle-outline"
            size={18}
            color={error ? palette.destructive : palette.fg(0.25)}
          />
          {error ? (
            <Typography
              weight="500"
              accessibilityLiveRegion="polite"
              className="flex-1 text-sm leading-5 text-destructive"
            >
              {error}
            </Typography>
          ) : (
            <Typography className="flex-1 text-sm leading-5 text-foreground/40">
              We read everything but cannot answer here. Need a reply?{" "}
              <Typography
                weight="600"
                accessibilityRole="link"
                onPress={() => router.replace("/settings/support" as never)}
                className="text-sm text-foreground underline"
              >
                Contact support
              </Typography>
            </Typography>
          )}
        </View>

        <View className="flex-1" />

        <HapticPressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend, busy }}
          onPress={send}
          disabled={!canSend}
          className={cn(
            "mb-2 h-14 items-center justify-center rounded-full",
            canSend ? "bg-primary" : "bg-primary/50"
          )}
        >
          {busy ? (
            <ActivityIndicator color={palette.primaryForeground} />
          ) : (
            <Typography
              weight="700"
              className="text-[15px] text-primary-foreground"
            >
              Send feedback
            </Typography>
          )}
        </HapticPressable>
      </KeyboardAvoidingView>
    </ScreenLayout>
  );
}
