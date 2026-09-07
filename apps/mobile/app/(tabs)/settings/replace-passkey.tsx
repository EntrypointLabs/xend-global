import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { ScreenVerificationCodeInput } from "@/components/ui/organisms";
import { useAuth } from "@/contexts/AuthContext";
import { usePasskeyLogin } from "@/hooks/usePasskeyLogin";
import { useReplacePasskey } from "@/hooks/useReplacePasskey";
import { apiClient, apiErrorCode, apiErrorStatus } from "@/utils/apiClient";

type Stage = "explain" | "code" | "working" | "waiting";

/**
 * Replaces the passkey that signs into this Account after it is gone.
 *
 * A deleted passkey is as unrecoverable as a lost phone, so this is the
 * mirror of restoring one: a fresh credential is created here and swapped
 * into the signer set, approved by the Device Key on this phone and the
 * recovery signer the emailed code releases. The old passkey never signs
 * anything again, and the new one opens the Account once the one day delay
 * runs out.
 */
export default function ReplacePasskeyScreen() {
  const { email } = useAuth();
  const passkey = usePasskeyLogin();
  const replacement = useReplacePasskey();
  const [stage, setStage] = useState<Stage>("explain");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [activeAt, setActiveAt] = useState<string | null>(null);

  const sendCode = async () => {
    setError(null);
    try {
      await apiClient.requestPasskeyRotationCode();
      setStage("code");
    } catch (err) {
      setError(
        apiErrorStatus(err) === 429
          ? "Too many codes. Wait a few minutes and try again."
          : "Could not send a code to your email."
      );
    }
  };

  const confirm = async (code: string) => {
    setError(null);
    setStage("working");
    try {
      const { grantId } = await apiClient.verifyPasskeyRotationCode(code);
      const privyIdToken = await passkey.createReplacement();
      if (!privyIdToken) {
        setError(passkey.error ?? "The passkey was not created.");
        setStage("code");
        setAttempt((n) => n + 1);
        return;
      }
      try {
        const outcome = await replacement.mutateAsync({
          grantId,
          privyIdToken,
        });
        setActiveAt(outcome.waitingUntil);
        setStage("waiting");
      } finally {
        await passkey.discardPrivySession();
      }
    } catch (err) {
      const status = apiErrorStatus(err);
      setError(
        apiErrorCode(err) === "PASSKEY_IN_USE"
          ? "That passkey already belongs to an account. It has to be a brand new one."
          : status === 401
            ? "That code is not right. Check the email and try again."
            : status === 409
              ? "That code has expired. Go back and send a new one."
              : "Could not replace the passkey. Please try again."
      );
      setStage("code");
      setAttempt((n) => n + 1);
    }
  };

  if (stage === "waiting") {
    return (
      <ScreenLayout>
        <View className="flex-1 items-center justify-center px-3">
          <View className="size-16 items-center justify-center rounded-3xl bg-black">
            <Ionicons name="time-outline" size={30} color="#FFFFFF" />
          </View>
          <Typography weight="700" className="mt-6 text-3xl text-black">
            Replacing your passkey
          </Typography>
          <Typography
            weight="500"
            className="mt-3 text-center text-base leading-6 text-black/40"
          >
            {activeAt
              ? `It takes over on ${when(activeAt)}. After that, sign in with the passkey you just created.`
              : "It takes over after a one day security delay. After that, sign in with the passkey you just created."}
          </Typography>
          <Typography
            weight="400"
            className="mt-6 text-center text-sm leading-5 text-black/40"
          >
            Until then nothing changes, and this phone can cancel it if it was
            not you.
          </Typography>
          <HapticPressable
            onPress={() => router.dismissAll()}
            className="mt-10 h-14 w-full items-center justify-center rounded-full bg-black"
          >
            <Typography weight="700" className="text-[15px] text-white">
              Done
            </Typography>
          </HapticPressable>
        </View>
      </ScreenLayout>
    );
  }

  return (
    <ScreenLayout>
      <View className="flex-1 px-3">
        <HapticPressable
          onPress={() =>
            stage === "code" ? setStage("explain") : router.back()
          }
          disabled={stage === "working"}
          className="size-10 items-center justify-center rounded-full bg-black/[0.08]"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={20} color="#00000066" />
        </HapticPressable>

        <Typography
          weight="700"
          className="mt-10 text-5xl leading-[44px] text-black"
        >
          {stage === "code" ? "Confirm email" : "Replace\nyour passkey"}
        </Typography>

        {stage === "code" ? (
          <>
            <Typography weight="500" className="mt-8 text-lg text-black/40">
              The code has been sent to
            </Typography>
            <Typography weight="600" className="mt-3 text-2xl text-black">
              {email}
            </Typography>
            <Typography
              weight="500"
              className="mt-8 text-lg leading-7 text-black/40"
            >
              Please check your inbox and{"\n"}paste the code from the email
              below
            </Typography>

            <View className="mt-8">
              <ScreenVerificationCodeInput
                key={attempt}
                tone="light"
                onCodeComplete={confirm}
              />
            </View>
          </>
        ) : (
          <>
            <Typography
              weight="500"
              className="mt-6 text-lg leading-7 text-black"
            >
              If the passkey that signs you in is gone, this phone can put a new
              one on your account.
            </Typography>

            <View className="mt-8 gap-5 rounded-3xl bg-black/[0.03] p-5">
              <Step
                icon="mail-outline"
                title="We email you a code"
                body={`Sent to ${email ?? "your address"}, which is your Recovery Key.`}
              />
              <Step
                icon="finger-print-outline"
                title="You create a new passkey"
                body="A brand new one, saved to this phone's password manager."
              />
              <Step
                icon="time-outline"
                title="One day before it takes over"
                body="The delay is what lets this phone stop it if it was not you."
              />
            </View>
          </>
        )}

        {stage === "working" && (
          <View className="mt-8 items-center">
            <ActivityIndicator color="#000" />
            <Typography weight="500" className="mt-3 text-sm text-black/40">
              Approving on this phone
            </Typography>
          </View>
        )}

        {(error ?? passkey.error) && (
          <Typography weight="500" className="mt-6 text-sm text-destructive">
            {error ?? passkey.error}
          </Typography>
        )}

        <View className="flex-1" />

        {stage === "explain" && (
          <HapticPressable
            onPress={sendCode}
            className="mb-4 h-14 w-full items-center justify-center rounded-full bg-black"
          >
            <Typography weight="700" className="text-[15px] text-white">
              Send me a code
            </Typography>
          </HapticPressable>
        )}
      </View>
    </ScreenLayout>
  );
}

function Step({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View className="flex-row gap-4">
      <View className="size-10 items-center justify-center rounded-2xl bg-black/[0.06]">
        <Ionicons name={icon} size={18} color="#000000" />
      </View>
      <View className="flex-1">
        <Typography weight="600" className="text-base text-black">
          {title}
        </Typography>
        <Typography
          weight="500"
          className="mt-0.5 text-sm leading-5 text-black/40"
        >
          {body}
        </Typography>
      </View>
    </View>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}
