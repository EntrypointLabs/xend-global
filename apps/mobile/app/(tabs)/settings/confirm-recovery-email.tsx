import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { ScreenVerificationCodeInput } from "@/components/ui/organisms";
import {
  useVerifyContactRotation,
  useVerifyRecoveryEmail,
} from "@/hooks/useRecoveryKeys";
import { apiErrorStatus } from "@/utils/apiClient";
import { usePalette } from "@/hooks/usePalette";
import { trackFlow } from "@/utils/analytics";

/**
 * The code step, between giving an address and reviewing the key it becomes.
 *
 * There is no button: the sixth digit submits. A code is either right or it is
 * not, and asking someone to confirm what they just finished typing is a tap
 * that decides nothing.
 *
 * A code proves one purpose. The one sent for a contact address change is
 * checked against that purpose, so a code for adding a key cannot be spent on
 * moving the address, and the other way round.
 */
export default function ConfirmRecoveryEmailScreen() {
  const palette = usePalette();
  const { email, intent, current } = useLocalSearchParams<{
    email: string;
    intent?: "change";
    current?: string;
  }>();
  const changing = intent === "change";
  const verifyAdd = useVerifyRecoveryEmail();
  const verifyRotation = useVerifyContactRotation();
  const verify = changing ? verifyRotation : verifyAdd;
  const [error, setError] = useState<string | null>(null);
  /** Remounts the boxes after a refusal, so the next attempt starts empty. */
  const [attempt, setAttempt] = useState(0);

  const confirm = async (code: string) => {
    if (!email) return;
    setError(null);
    try {
      const { grantId } = await verify.mutateAsync({ email, code });
      router.push({
        pathname: "/settings/confirm-recovery-key",
        params: changing
          ? { email, grantId, intent, current }
          : { email, grantId },
      } as never);
    } catch (err) {
      trackFlow("recovery_change", {
        rail: changing ? "email_change" : "email",
      }).failed(err, { step: "verify" });
      const status = apiErrorStatus(err);
      setError(
        status === 401
          ? "That code is not right. Check the email and try again."
          : status === 409
            ? "That code has expired. Go back and send a new one."
            : "Could not check that code."
      );
      setAttempt((n) => n + 1);
    }
  };

  return (
    <ScreenLayout>
      <View className="flex-1 px-3">
        <HapticPressable
          onPress={() => router.back()}
          disabled={verify.isPending}
          className="size-10 items-center justify-center rounded-full bg-foreground/[0.08]"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={20} color={palette.fg(0.4)} />
        </HapticPressable>

        <Typography
          weight="700"
          className="mt-10 text-5xl leading-[44px] text-foreground"
        >
          Confirm email
        </Typography>

        <Typography weight="500" className="mt-8 text-lg text-foreground/40">
          The code has been sent to
        </Typography>
        <Typography weight="600" className="mt-3 text-2xl text-foreground">
          {email}
        </Typography>

        <Typography
          weight="500"
          className="mt-8 text-lg leading-7 text-foreground/40"
        >
          Please check your inbox and{"\n"}paste the code from the email below
        </Typography>

        <View className="mt-8">
          <ScreenVerificationCodeInput
            key={attempt}
            tone="light"
            onCodeComplete={confirm}
          />
        </View>

        {verify.isPending && (
          <View className="mt-2 items-center">
            <ActivityIndicator color={palette.fg(0.4)} />
          </View>
        )}

        {error && (
          <Typography
            weight="500"
            className="mt-4 text-center text-sm text-destructive"
          >
            {error}
          </Typography>
        )}
      </View>
    </ScreenLayout>
  );
}
