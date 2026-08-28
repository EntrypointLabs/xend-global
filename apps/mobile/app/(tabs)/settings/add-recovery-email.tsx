import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { useRequestRecoveryEmailCode } from "@/hooks/useRecoveryKeys";
import { Email } from "@/types/Auth";
import { apiErrorStatus } from "@/utils/apiClient";

/**
 * Takes the address that will become a recovery key, and sends a code to it.
 *
 * Proved before it is staged, for the same reason the Consumer's first address
 * is: an inbox nobody answers at is not a way back into an Account, it is a
 * second thing that looks like one, and they only find out when they need it.
 */
export default function AddRecoveryEmailScreen() {
  const requestCode = useRequestRecoveryEmailCode();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const parsed = Email.safeParse(value.trim());
  const busy = requestCode.isPending;

  const send = async () => {
    if (!parsed.success) {
      setError("Enter a valid email address");
      return;
    }
    setError(null);
    try {
      await requestCode.mutateAsync(parsed.data);
      router.push({
        pathname: "/settings/confirm-recovery-email",
        params: { email: parsed.data },
      } as never);
    } catch (err) {
      setError(
        apiErrorStatus(err) === 409
          ? "That address is already a recovery key on this account."
          : "Could not send a code to that address."
      );
    }
  };

  return (
    <ScreenLayout>
      <KeyboardAvoidingView
        className="flex-1 px-3"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <HapticPressable
          onPress={() => router.back()}
          className="size-10 items-center justify-center rounded-full bg-black/[0.08]"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={20} color="#00000066" />
        </HapticPressable>

        <Typography
          weight="700"
          className="mt-10 text-5xl leading-[44px] text-black"
        >
          Email
        </Typography>

        <Typography
          weight="600"
          className="mt-5 text-[15px] leading-6 text-black"
        >
          Enter an address you can still reach{"\n"}if you lose this phone
        </Typography>

        <View className="mt-7 rounded-3xl bg-black/[0.03] px-5 py-4">
          <TextInput
            value={value}
            onChangeText={(text) => {
              setValue(text);
              setError(null);
            }}
            placeholder="you@example.com"
            placeholderTextColor="#00000040"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            autoFocus
            onSubmitEditing={send}
            returnKeyType="go"
            className="text-[15px] text-black"
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
            className={`flex-1 text-sm leading-5 ${
              error ? "text-destructive" : "text-black/40"
            }`}
          >
            {error ??
              "A Recovery Key restores your account. It can never move money on its own."}
          </Typography>
        </View>

        <View className="flex-1" />

        <HapticPressable
          onPress={send}
          disabled={!parsed.success || busy}
          className={`h-14 items-center justify-center rounded-full ${
            parsed.success && !busy ? "bg-black" : "bg-black/50"
          }`}
        >
          {busy ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Typography weight="700" className="text-[15px] text-white">
              Next
            </Typography>
          )}
        </HapticPressable>
      </KeyboardAvoidingView>
    </ScreenLayout>
  );
}
