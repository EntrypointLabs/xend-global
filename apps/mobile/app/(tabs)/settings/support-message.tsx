import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  View,
} from "react-native";
import Constants from "expo-constants";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { ScreenLayout } from "@/components/ui/layout";
import {
  MESSAGE_SCREEN_INSET,
  MessageField,
} from "@/components/ui/molecules/MessageField";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { apiClient, apiErrorCode } from "@/utils/apiClient";
import { cn } from "@/utils/cn";
import { isSupportTopic, SUPPORT_TOPIC_COPY } from "@/utils/support";

/** Contact support, second step: the message itself. */
export default function SupportMessageScreen() {
  const params = useLocalSearchParams<{ topic?: string }>();
  const topic = isSupportTopic(params.topic) ? params.topic : "other";
  const { email } = useAuth();
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
      await apiClient.contactSupport({
        topic,
        message: trimmed,
        appVersion: Constants.expoConfig?.version,
        platform: Platform.OS === "ios" ? "ios" : "android",
      });
    } catch (err) {
      setBusy(false);
      setError(
        apiErrorCode(err) === "SUPPORT_RATE_LIMITED"
          ? "You've sent a few messages already. Try again in a while."
          : "Couldn't send your message. Try again."
      );
      return;
    }
    showToast("Message sent");
    router.dismissAll();
  };

  return (
    <ScreenLayout>
      <KeyboardAvoidingView
        className="flex-1 px-3"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top + MESSAGE_SCREEN_INSET}
      >
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
          className="mt-6 text-3xl text-black"
        >
          Send us a message
        </Typography>

        <View className="mt-3 flex-row items-center gap-2">
          <Ionicons name="chatbubble-ellipses-outline" size={18} color="#000" />
          <Typography weight="500" className="text-[15px] text-black/40">
            This is about:{" "}
            <Typography weight="600" className="text-[15px] text-black">
              {SUPPORT_TOPIC_COPY[topic].label}
            </Typography>
          </Typography>
        </View>

        <View className="mt-5 shrink">
          <MessageField
            value={message}
            onChangeText={(text) => {
              setMessage(text);
              setError(null);
            }}
            placeholder="Give as much detail as you can"
            accessibilityLabel="Your message"
            editable={!busy}
          />
        </View>

        <View className="mt-4 flex-row gap-2">
          <Ionicons
            name="information-circle-outline"
            size={18}
            color={error ? "#F90101" : "#00000040"}
          />
          <Typography
            weight={error ? "500" : "400"}
            accessibilityLiveRegion="polite"
            className={cn(
              "flex-1 text-sm leading-5",
              error ? "text-destructive" : "text-black/40"
            )}
          >
            {error ??
              (email
                ? `We'll reply to ${email}`
                : "Add an email in Keys & Recovery so we can reply.")}
          </Typography>
        </View>

        <View className="flex-1" />

        <HapticPressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend, busy }}
          onPress={send}
          disabled={!canSend}
          className={cn(
            "mb-2 h-14 items-center justify-center rounded-full",
            canSend ? "bg-black" : "bg-black/50"
          )}
        >
          {busy ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Typography weight="700" className="text-[15px] text-white">
              Send message
            </Typography>
          )}
        </HapticPressable>
      </KeyboardAvoidingView>
    </ScreenLayout>
  );
}
