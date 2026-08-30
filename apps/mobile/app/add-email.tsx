import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { AccountSetupModal } from "@/components/ui/organisms/modals/AccountSetupModal";
import { ThemedTextInput } from "@/components/ui/molecules";
import { ScreenVerificationCodeInput } from "@/components/ui/organisms";
import { WithScreenTheme } from "@/components/WithScreenTheme";
import { useAccountSetup } from "@/hooks/useAccountSetup";
import { usePasskeyLogin } from "@/hooks/usePasskeyLogin";
import { useAuth } from "@/contexts/AuthContext";
import { Email } from "@/types/Auth";
import { apiClient, apiErrorCode, apiErrorStatus } from "@/utils/apiClient";
import { cn } from "@/utils/cn";

/**
 * The email door: the address a Consumer is reached at, proved by a code,
 * before there is a passkey or a session.
 *
 * What the code earns depends on the address, and is only known once it is
 * right. New here, the address anchors the recovery signer, minted the moment
 * the code is confirmed; the passkey comes next and is the credential, and
 * the Account is built after that. Already on an account, the code opens a
 * session that can look and start a recovery, and nothing more: spending
 * needs the passkey. Either way email never becomes a way to spend.
 *
 * A signed-in Consumer with no address on file lands here as well, and leaves
 * through the same Account setup once one is proved.
 */
type Step = "address" | "code" | "passkey";

function AddEmailScreen() {
  const {
    isAuthenticated,
    email: onFile,
    setEmail: setSessionEmail,
    enterWithEmail,
    logout,
  } = useAuth();
  const {
    signUp,
    busy: creatingPasskey,
    error: passkeyError,
    clearError: clearPasskeyError,
  } = usePasskeyLogin();
  const [step, setStep] = useState<Step>("address");
  const [value, setValue] = useState("");
  /**
   * The address a code went to, held apart from the input so the code step
   * confirms what was actually mailed rather than whatever the field says by
   * the time it is submitted.
   */
  const [claimed, setClaimed] = useState<string | null>(null);
  /**
   * What the code earned, and the only thing that lets the passkey created
   * next land on this address. Held in memory only: it lives fifteen minutes
   * and a fresh code replaces it.
   */
  const [signupToken, setSignupToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [settingUpAccount, setSettingUpAccount] = useState(false);
  const {
    stage: setupStage,
    error: setupError,
    run: runAccountSetup,
    clearError: clearSetupError,
  } = useAccountSetup();

  const signedIn = isAuthenticated === true;
  const done = () => router.replace("/(tabs)");

  const requestCode = async () => {
    const parsed = Email.safeParse(value.trim());
    if (!parsed.success) {
      setError("Please enter a valid email address");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      if (signedIn) {
        await apiClient.requestContactEmailCode(parsed.data);
      } else {
        await apiClient.requestSignupEmailCode(parsed.data);
      }
      setClaimed(parsed.data);
      setStep("code");
    } catch (err) {
      console.error("[add-email] could not send the code", err);
      const status = apiErrorStatus(err);
      setError(
        status === 409
          ? "That email is already on another account."
          : status === 429
            ? "Too many codes. Wait a few minutes and try again."
            : "Could not send a code to that address. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const confirmCode = async (entered: string) => {
    if (!claimed || entered.length !== 6) {
      setError("Enter the six digits from the email");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      if (signedIn) {
        await apiClient.setContactEmail(claimed, entered);
        setSessionEmail(claimed);
        // The one moment the fingerprint prompts it costs read as part of
        // signing up rather than as an ambush on an empty dashboard.
        setSettingUpAccount(true);
      } else {
        const proof = await apiClient.verifySignupEmail(claimed, entered);
        if (proof.kind === "entry") {
          // An address already on an account. The session it opens is the
          // one the home screen explains; there is nothing to create here.
          await enterWithEmail(proof);
          done();
          return;
        }
        setSignupToken(proof.signupToken);
        setStep("passkey");
      }
    } catch (err) {
      console.error("[add-email] could not confirm the code", err);
      const status = apiErrorStatus(err);
      setError(
        status === 401
          ? "That code is not right. Check the email and try again."
          : apiErrorCode(err) === "EMAIL_IN_USE"
            ? "That email is already on another account."
            : status === 409
              ? "That code has expired. Send a new one."
              : status === 429
                ? "Too many attempts. Wait a few minutes and try again."
                : "Could not confirm that code. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const createPasskey = async () => {
    if (!signupToken) return;
    if (await signUp(signupToken)) setSettingUpAccount(true);
  };

  /** Back to the address, so a typo is fixable without leaving the screen. */
  const editAddress = () => {
    setStep("address");
    setClaimed(null);
    setSignupToken(null);
    setError(null);
    clearPasskeyError();
  };

  const onRunAccountSetup = async () => {
    if (await runAccountSetup()) done();
  };

  /**
   * Letting them through unfinished is deliberate. They can still receive at
   * their address, and blocking sign-up on a step that can be retried later is
   * worse than the degraded state it protects against.
   */
  const onSkipAccountSetup = () => {
    clearSetupError();
    done();
  };

  const disabled = saving || !value.trim();

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View className="flex-1">
        <GradientBackground />

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1"
        >
          <ScrollView
            className="flex-1"
            contentContainerClassName="flex-grow"
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            bounces={false}
          >
            <View className="flex-1 justify-end px-8 py-16">
              <Typography weight="600" className="mb-3 text-3xl text-white">
                {step === "address"
                  ? signedIn
                    ? "Add your email"
                    : "What's your email?"
                  : step === "code"
                    ? "Check your email"
                    : "Create your passkey"}
              </Typography>
              <Typography
                weight="400"
                className="mb-8 text-base leading-6 text-[#8FE5F6]"
              >
                {step === "address"
                  ? "For receipts and security alerts, and how your account comes back if you lose this phone. It is not how you sign in: that is your passkey."
                  : step === "code"
                    ? `We sent a six-digit code to ${claimed}. Enter it to prove this inbox is yours.`
                    : "Your passkey is what signs you in. It lives in your phone's password manager, so there is nothing to remember."}
              </Typography>

              {step === "code" ? (
                // The same six boxes everywhere a code is typed, so a code
                // looks like a code across the product. It submits on the
                // sixth digit, which is why there is no separate button.
                <ScreenVerificationCodeInput
                  key={claimed}
                  onCodeComplete={confirmCode}
                />
              ) : step === "address" ? (
                <ThemedTextInput
                  value={value}
                  onChangeText={(text) => {
                    setValue(text);
                    setError(null);
                  }}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  error={!!error}
                  onSubmitEditing={requestCode}
                  returnKeyType="go"
                  editable={!saving}
                />
              ) : null}

              {error && (
                <Typography weight="400" className="mt-2 text-sm text-red-400">
                  {error}
                </Typography>
              )}
              {step === "passkey" && passkeyError && (
                <Typography weight="400" className="mb-2 text-sm text-red-400">
                  {passkeyError}
                </Typography>
              )}

              {step === "address" && (
                <HapticPressable
                  onPress={requestCode}
                  disabled={disabled}
                  className={cn(
                    "mt-6 items-center justify-center rounded-full bg-white p-4",
                    disabled && "opacity-50"
                  )}
                >
                  {saving ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <Typography weight="600" className="text-lg text-black">
                      Send me a code
                    </Typography>
                  )}
                </HapticPressable>
              )}

              {step === "code" && saving && (
                <View className="mt-2 items-center p-4">
                  <ActivityIndicator color="#FFF" />
                </View>
              )}

              {step === "passkey" && (
                <HapticPressable
                  onPress={createPasskey}
                  disabled={creatingPasskey}
                  className={cn(
                    "w-full flex-row items-center justify-center gap-4 rounded-full bg-white p-4",
                    creatingPasskey && "opacity-50"
                  )}
                >
                  <Ionicons
                    name="finger-print-outline"
                    size={22}
                    color="#000000"
                  />
                  <Typography weight="600" className="text-lg text-black">
                    {creatingPasskey
                      ? "Creating…"
                      : passkeyError
                        ? "Try again"
                        : "Create passkey"}
                  </Typography>
                </HapticPressable>
              )}

              {step !== "address" ? (
                <HapticPressable
                  onPress={editAddress}
                  disabled={saving || creatingPasskey}
                  className="mt-4 items-center p-2"
                >
                  <Typography weight="500" className="text-base text-white">
                    Use a different address
                  </Typography>
                </HapticPressable>
              ) : !signedIn ? (
                <HapticPressable
                  onPress={() => router.replace("/(auth)/login")}
                  disabled={saving}
                  className="mt-4 items-center p-2"
                >
                  <Typography weight="500" className="text-base text-white">
                    Back
                  </Typography>
                </HapticPressable>
              ) : onFile ? (
                // Reached deliberately by somebody who already has an address,
                // so there is nothing to insist on and leaving is free.
                <HapticPressable
                  onPress={done}
                  disabled={saving}
                  className="mt-4 items-center p-2"
                >
                  <Typography weight="500" className="text-base text-white">
                    Cancel
                  </Typography>
                </HapticPressable>
              ) : (
                // The escape, and deliberately not a skip. Somebody who cannot
                // receive mail at any address they hold should leave with no
                // account rather than with one nobody can ever recover.
                <HapticPressable
                  onPress={logout}
                  disabled={saving}
                  className="mt-4 items-center p-2"
                >
                  <Typography
                    weight="500"
                    className="text-base text-white/70 underline"
                  >
                    Sign out
                  </Typography>
                </HapticPressable>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        <AccountSetupModal
          visible={settingUpAccount}
          stage={setupStage}
          error={setupError}
          onStart={onRunAccountSetup}
          onRetry={onRunAccountSetup}
          onSkip={onSkipAccountSetup}
        />
      </View>
    </TouchableWithoutFeedback>
  );
}

const GradientBackground = () => (
  <>
    <Image
      source={require("@/assets/images/onboarding/blue-blur-1.png")}
      className="absolute bottom-[58px] left-0 h-[468px] w-full"
      resizeMode="stretch"
    />
    <Image
      source={require("@/assets/images/onboarding/blue-blur-2.png")}
      className="absolute bottom-[-17px] left-0 h-[468px] w-full"
      resizeMode="cover"
    />
    <Image
      source={require("@/assets/images/onboarding/blue-blur-3.png")}
      className="absolute bottom-[-134px] left-0 h-[468px] w-full"
      resizeMode="cover"
    />
  </>
);

export default WithScreenTheme(AddEmailScreen, {
  backgroundColor: "#000000",
  textColor: "#FFFFFF",
  primaryColor: "#FFFFFF",
});
