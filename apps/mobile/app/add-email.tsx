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

import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { AccountSetupModal } from "@/components/ui/organisms/modals/AccountSetupModal";
import { ThemedTextInput } from "@/components/ui/molecules";
import { ScreenVerificationCodeInput } from "@/components/ui/organisms";
import { WithScreenTheme } from "@/components/WithScreenTheme";
import { useAccountSetup } from "@/hooks/useAccountSetup";
import { useAuth } from "@/contexts/AuthContext";
import { Email } from "@/types/Auth";
import { apiClient, apiErrorStatus } from "@/utils/apiClient";

/**
 * The last step of signing up, and not a skippable one.
 *
 * A passkey is the credential now, so this address is a way to reach the
 * Consumer rather than a way in. It is still required, because the recovery
 * signer is anchored on it and S3 is mandatory at Account creation (D10b).
 * Skipping left a Consumer with no Account, no recovery signer and no way to
 * recover a lost phone: the 0 of 3 state the whole design exists to prevent.
 *
 * The only ways off this screen are a proved address or signing out, which is
 * deliberate. Everything else would be a route into the app for somebody the
 * product cannot get back to.
 *
 * The Account is built from here rather than from the sign-up screen, because
 * the recovery signer is anchored on this address: there is nothing to create
 * until it exists. Skipping leaves the Consumer on their Privy wallet, and the
 * signed-in shell asks again on the next launch.
 */
function AddEmailScreen() {
  const { email: onFile, setEmail: setSessionEmail, logout } = useAuth();
  const [value, setValue] = useState("");
  /**
   * Null until a code has been sent, then the address it went to.
   *
   * Held separately from the input so the code step confirms the address that
   * was actually mailed, not whatever the field says by the time it is
   * submitted.
   */
  const [claimed, setClaimed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [settingUpAccount, setSettingUpAccount] = useState(false);
  const {
    stage: setupStage,
    error: setupError,
    run: runAccountSetup,
    clearError: clearSetupError,
  } = useAccountSetup();

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
      await apiClient.requestContactEmailCode(parsed.data);
      setClaimed(parsed.data);
    } catch (err) {
      console.error("[add-email] could not send the code", err);
      setError(
        apiErrorStatus(err) === 409
          ? "That email is already on another account."
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
      await apiClient.setContactEmail(claimed, entered);
      setSessionEmail(claimed);
      // The one moment the fingerprint prompts it costs read as part of
      // signing up rather than as an ambush on an empty dashboard.
      setSettingUpAccount(true);
    } catch (err) {
      console.error("[add-email] could not confirm the code", err);
      const status = apiErrorStatus(err);
      setError(
        status === 401
          ? "That code is not right. Check the email and try again."
          : status === 409
            ? "That code has expired. Send a new one."
            : status === 429
              ? "Too many codes. Wait a few minutes and try again."
              : "Could not confirm that code. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  /** Back to the address, so a typo is fixable without leaving the screen. */
  const editAddress = () => {
    setClaimed(null);
    setError(null);
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
          style={{ flex: 1 }}
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
                {claimed ? "Check your email" : "Add your email"}
              </Typography>
              <Typography
                weight="400"
                className="mb-8 text-base leading-6 text-[#8FE5F6]"
              >
                {claimed
                  ? `We sent a six-digit code to ${claimed}. Confirming it is what lets this address bring your account back if you lose this phone.`
                  : "For receipts and security alerts. Your passkey is what signs you in, so this is not a way into your account."}
              </Typography>

              {claimed ? (
                // The same six boxes the email sign-in used, so a code looks
                // like a code everywhere in the product. It submits on the
                // sixth digit, which is why there is no separate button.
                <ScreenVerificationCodeInput
                  key={claimed}
                  onCodeComplete={confirmCode}
                />
              ) : (
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
              )}

              {error && (
                <Typography weight="400" className="mt-2 text-sm text-red-400">
                  {error}
                </Typography>
              )}

              {claimed ? (
                saving ? (
                  <View className="mt-2 items-center p-4">
                    <ActivityIndicator color="#FFF" />
                  </View>
                ) : null
              ) : (
                <HapticPressable
                  onPress={requestCode}
                  disabled={disabled}
                  className="mt-6 items-center justify-center rounded-full bg-white p-4"
                  style={{ opacity: disabled ? 0.5 : 1 }}
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

              {claimed ? (
                <HapticPressable
                  onPress={editAddress}
                  disabled={saving}
                  className="mt-4 items-center p-2"
                >
                  <Typography weight="500" className="text-base text-white">
                    Use a different address
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
