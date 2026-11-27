import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import {
  useRequestContactRotationCode,
  useRequestRecoveryEmailCode,
} from "@/hooks/useRecoveryKeys";
import { Email } from "@/types/Auth";
import { apiErrorStatus } from "@/utils/apiClient";
import { usePalette } from "@/hooks/usePalette";
import { trackFlow } from "@/utils/analytics";

/**
 * Takes the address that will become a recovery key, and sends a code to it.
 *
 * Proved before it is staged, for the same reason the Consumer's first address
 * is: an inbox nobody answers at is not a way back into an Account, it is a
 * second thing that looks like one, and they only find out when they need it.
 *
 * With `intent=change` the address replaces the one on file instead of
 * joining it. Same screen, same code: the difference is which key the change
 * that follows carries out.
 */
export default function AddRecoveryEmailScreen() {
  const palette = usePalette();
  const { intent, current } = useLocalSearchParams<{
    intent?: "change";
    current?: string;
  }>();
  const changing = intent === "change";
  const requestCode = useRequestRecoveryEmailCode();
  const requestRotationCode = useRequestContactRotationCode();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const parsed = Email.safeParse(value.trim());
  const busy = requestCode.isPending || requestRotationCode.isPending;

  const send = async () => {
    if (!parsed.success) {
      setError("Enter a valid email address");
      return;
    }
    setError(null);
    const flow = trackFlow("recovery_change", {
      rail: changing ? "email_change" : "email",
    });
    flow.started();
    try {
      await (changing ? requestRotationCode : requestCode).mutateAsync(
        parsed.data
      );
      router.push({
        pathname: "/settings/confirm-recovery-email",
        params: changing
          ? { email: parsed.data, intent, current }
          : { email: parsed.data },
      } as never);
    } catch (err) {
      flow.failed(err, { step: "code" });
      setError(
        apiErrorStatus(err) === 409
          ? changing
            ? "That address is already on this account, or belongs to another one."
            : "That address is already a recovery key on this account."
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
          className="size-10 items-center justify-center rounded-full bg-foreground/[0.08]"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={20} color={palette.fg(0.4)} />
        </HapticPressable>

        <Typography
          weight="700"
          className="mt-10 text-5xl leading-[44px] text-foreground"
        >
          {changing ? "New email" : "Email"}
        </Typography>

        <Typography
          weight="600"
          className="mt-5 text-[15px] leading-6 text-foreground"
        >
          {changing
            ? "Enter the address that will replace\nthe one on your account"
            : "Enter an address you can still reach\nif you lose this phone"}
        </Typography>

        <View className="mt-7 rounded-3xl bg-foreground/[0.03] px-5 py-4">
          <TextInput
            value={value}
            onChangeText={(text) => {
              setValue(text);
              setError(null);
            }}
            placeholder="you@example.com"
            placeholderTextColor={palette.fg(0.25)}
            keyboardAppearance={palette.dark ? "dark" : "light"}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            autoFocus
            onSubmitEditing={send}
            returnKeyType="go"
            className="text-[15px] text-foreground"
          />
        </View>

        <View className="mt-4 flex-row gap-2">
          <Ionicons
            name="information-circle-outline"
            size={18}
            color={error ? palette.destructive : palette.fg(0.25)}
          />
          <Typography
            weight={error ? "500" : "400"}
            className={`flex-1 text-sm leading-5 ${
              error ? "text-destructive" : "text-foreground/40"
            }`}
          >
            {error ??
              (changing
                ? "Your current address stays on your account until both Active Keys approve the change and a one day delay passes."
                : "A Recovery Key restores your account. It can never move money on its own.")}
          </Typography>
        </View>

        <View className="flex-1" />

        <HapticPressable
          onPress={send}
          disabled={!parsed.success || busy}
          className={`h-14 items-center justify-center rounded-full ${
            parsed.success && !busy ? "bg-primary" : "bg-primary/50"
          }`}
        >
          {busy ? (
            <ActivityIndicator color={palette.primaryForeground} />
          ) : (
            <Typography
              weight="700"
              className="text-[15px] text-primary-foreground"
            >
              Next
            </Typography>
          )}
        </HapticPressable>
      </KeyboardAvoidingView>
    </ScreenLayout>
  );
}
