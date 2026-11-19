import React from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { Typography } from "@/components/ui/atoms/Typography";
import { PillButton } from "@/components/ui/kit";
import { Illustration } from "@/components/ui/feature/Illustration";

/**
 * The one way the app says something failed, on any page: the error
 * illustration, a fixed headline, a plain sentence about what went wrong, and
 * a way forward. `onRetry` adds Try again above Close.
 */
export function ErrorState({
  message = "We could not finish that. Check your connection and try again.",
  onRetry,
  onClose,
}: {
  message?: string;
  onRetry?: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="alert"
      className="flex-1 bg-white px-5"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom + 12 }}
    >
      <StatusBar style="dark" />
      <View className="flex-1 items-center justify-center">
        <Illustration name="error" size={150} />
        <Typography
          weight="700"
          className="mt-8 text-center text-[28px] leading-[34px] tracking-[-0.6px] text-[#0E0F0C]"
        >
          Oops. Something went wrong.
        </Typography>
        <Typography
          weight="500"
          className="mt-2 max-w-[300px] text-center text-[14px] leading-[20px] text-black/50"
        >
          {message}
        </Typography>
      </View>
      <View className="gap-3">
        {onRetry ? <PillButton title="Try again" onPress={onRetry} /> : null}
        <PillButton
          title="Close"
          tone={onRetry ? "quiet" : "solid"}
          onPress={onClose}
        />
      </View>
    </View>
  );
}
