import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { ScreenVerificationCodeInput } from "@/components/ui/organisms";
import { useAuth } from "@/contexts/AuthContext";
import { useDeviceRotation } from "@/hooks/useDeviceRotation";
import { usePasskeyLogin } from "@/hooks/usePasskeyLogin";
import { apiClient, apiErrorStatus } from "@/utils/apiClient";

type Stage = "explain" | "code" | "working" | "waiting";

/**
 * Moves the Account's Device Key onto this phone after the old one is gone.
 *
 * The old phone's key cannot be copied: hardware keys are non-exportable, so
 * this mints a new one here and swaps it into the signer set. That swap needs
 * two of three, and the one that is missing is the Device Key itself, so the
 * pair is the passkey on this phone and the recovery signer, which is what the
 * emailed code releases.
 *
 * It takes a day, and the screen says so before the Consumer starts rather
 * than after. The delay is the control: an inbox plus a passkey is exactly the
 * pair it exists to make visible, and the phone they still hold can reject it
 * inside the window.
 */
export default function RestoreDeviceScreen() {
  const { email, sessionTier } = useAuth();
  const rotation = useDeviceRotation();
  // The swap is signed by the passkey on this phone, and an email-only
  // session has none to sign with. Asked for here, before the code goes out,
  // rather than discovered when the first step fails to sign.
  const passkey = usePasskeyLogin();
  const needsPasskey = sessionTier === "entry";
  const [stage, setStage] = useState<Stage>("explain");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [activeAt, setActiveAt] = useState<string | null>(null);

  const sendCode = async () => {
    setError(null);
    try {
      await apiClient.requestDeviceRotationCode();
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
      const { grantId } = await apiClient.verifyDeviceRotationCode(code);
      const outcome = await rotation.mutateAsync(grantId);
      setActiveAt(outcome.waitingUntil);
      setStage("waiting");
    } catch (err) {
      const status = apiErrorStatus(err);
      setError(
        status === 401
          ? "That code is not right. Check the email and try again."
          : status === 409
            ? "That code has expired. Go back and send a new one."
            : "Could not recover on this phone. Please try again."
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
            Recovering on this phone
          </Typography>
          <Typography
            weight="500"
            className="mt-3 text-center text-base leading-6 text-black/40"
          >
            {activeAt
              ? `It finishes on ${when(activeAt)}. Open Xend after that and this phone takes over as your Device Key.`
              : "It finishes after a one day security delay. Open Xend after that and this phone takes over as your Device Key."}
          </Typography>
          <Typography
            weight="400"
            className="mt-6 text-center text-sm leading-5 text-black/40"
          >
            If you still have your old phone, you can cancel this from there
            before it lands.
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
          {stage === "code" ? "Confirm email" : "Recover on\nthis phone"}
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
              Your Device Key lives on the phone you set Xend up with, and it
              cannot be copied here.
            </Typography>

            <View className="mt-8 gap-5 rounded-3xl bg-black/[0.03] p-5">
              <Step
                icon="mail-outline"
                title="We email you a code"
                body={`Sent to ${email ?? "your address"}, which is your Recovery Key.`}
              />
              <Step
                icon="key-outline"
                title="This phone gets its own key"
                body="A new Device Key, made here and held by this phone alone."
              />
              <Step
                icon="time-outline"
                title="One day before it takes effect"
                body="The delay is what lets you stop this from your old phone if it was not you."
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

        {(error ?? (needsPasskey ? passkey.error : null)) && (
          <Typography weight="500" className="mt-6 text-sm text-destructive">
            {error ?? passkey.error}
          </Typography>
        )}

        <View className="flex-1" />

        {stage === "explain" && needsPasskey ? (
          <>
            <Typography
              weight="500"
              className="mb-4 text-center text-sm leading-5 text-black/40"
            >
              Your passkey signs this swap, so sign in with it first. The code
              comes after.
            </Typography>
            <HapticPressable
              onPress={() => void passkey.signIn()}
              disabled={passkey.busy}
              className="h-14 flex-row items-center justify-center gap-3 rounded-full bg-black"
            >
              <Ionicons name="finger-print-outline" size={20} color="#FFFFFF" />
              <Typography weight="700" className="text-[15px] text-white">
                {passkey.busy
                  ? "Waiting for your passkey"
                  : "Sign in with passkey"}
              </Typography>
            </HapticPressable>
          </>
        ) : (
          stage === "explain" && (
            <HapticPressable
              onPress={sendCode}
              className="h-14 items-center justify-center rounded-full bg-black"
            >
              <Typography weight="700" className="text-[15px] text-white">
                Email me a code
              </Typography>
            </HapticPressable>
          )
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
      <Ionicons name={icon} size={20} color="#000000" />
      <View className="flex-1">
        <Typography weight="600" className="text-[15px] text-black">
          {title}
        </Typography>
        <Typography
          weight="400"
          className="mt-1 text-sm leading-5 text-black/40"
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
