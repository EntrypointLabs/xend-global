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
import { WithScreenTheme } from "@/components/WithScreenTheme";
import { useAccountSetup } from "@/hooks/useAccountSetup";
import { useAuth } from "@/contexts/AuthContext";
import { Email } from "@/types/Auth";
import { apiClient, apiErrorStatus } from "@/utils/apiClient";

/**
 * The last step of signing up, and the only one that is optional.
 *
 * A passkey is the credential now, so this address is a way to reach the
 * Consumer rather than a way in. That is why it can be skipped: an account
 * with no email is fully usable, and asking before they have seen the app
 * would be charging for something they cannot yet judge the value of.
 *
 * The Account is built from here rather than from the sign-up screen, because
 * the recovery signer is anchored on this address: there is nothing to create
 * until it exists. Skipping leaves the Consumer on their Privy wallet, and the
 * signed-in shell asks again on the next launch.
 */
function AddEmailScreen() {
  const { setEmail: setSessionEmail, completePasskeySetup } = useAuth();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [settingUpAccount, setSettingUpAccount] = useState(false);
  const {
    stage: setupStage,
    error: setupError,
    run: runAccountSetup,
    clearError: clearSetupError,
  } = useAccountSetup();

  const done = () => {
    // Released here rather than on the sign-up screen: doing it there would
    // let the root layout redirect to the tabs before this screen was ever
    // reached, and the ask would be skipped silently.
    completePasskeySetup();
    router.replace("/(tabs)");
  };

  const save = async () => {
    const parsed = Email.safeParse(value.trim());
    if (!parsed.success) {
      setError("Please enter a valid email address");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await apiClient.setContactEmail(parsed.data);
      setSessionEmail(parsed.data);
      // The one moment the fingerprint prompts it costs read as part of
      // signing up rather than as an ambush on an empty dashboard.
      setSettingUpAccount(true);
    } catch (err) {
      console.error("[add-email] could not save contact email", err);
      setError(
        apiErrorStatus(err) === 409
          ? "That email is already on another account."
          : "Could not save your email. Please try again."
      );
    } finally {
      setSaving(false);
    }
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
                Add your email
              </Typography>
              <Typography
                weight="400"
                className="mb-8 text-base leading-6 text-[#8FE5F6]"
              >
                For receipts and security alerts. Your passkey is what signs you
                in, so this is not a way into your account.
              </Typography>

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
                onSubmitEditing={save}
                returnKeyType="go"
                editable={!saving}
              />

              {error && (
                <Typography weight="400" className="mt-2 text-sm text-red-400">
                  {error}
                </Typography>
              )}

              <HapticPressable
                onPress={save}
                disabled={disabled}
                className="mt-6 items-center justify-center rounded-full bg-white p-4"
                style={{ opacity: disabled ? 0.5 : 1 }}
              >
                {saving ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Typography weight="600" className="text-lg text-black">
                    Save email
                  </Typography>
                )}
              </HapticPressable>

              <HapticPressable
                onPress={done}
                disabled={saving}
                className="mt-4 items-center p-2"
              >
                <Typography weight="500" className="text-base text-white">
                  Not now
                </Typography>
              </HapticPressable>
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
