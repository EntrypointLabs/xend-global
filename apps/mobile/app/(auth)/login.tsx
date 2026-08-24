import React, { useState } from "react";
import { Image, View } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import { WithScreenTheme } from "@/components/WithScreenTheme";
import { router } from "expo-router";
import Logo from "@/components/Logo";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Ionicons } from "@expo/vector-icons";
import { usePasskeyLogin } from "@/hooks/usePasskeyLogin";
import { NoPasskeyModal } from "@/components/ui/organisms/modals/NoPasskeyModal";
import { AccountSetupModal } from "@/components/ui/organisms/modals/AccountSetupModal";
import { useAccountSetup } from "@/hooks/useAccountSetup";
import { useAuth } from "@/contexts/AuthContext";

function LoginScreen() {
  const {
    signIn,
    signUp,
    busy,
    error: passkeyError,
    clearError,
  } = usePasskeyLogin();
  const { beginPasskeySignup, completePasskeySetup } = useAuth();
  const [askingToCreate, setAskingToCreate] = useState(false);
  const [settingUpAccount, setSettingUpAccount] = useState(false);
  const {
    stage: setupStage,
    error: setupError,
    run: runAccountSetup,
    clearError: clearSetupError,
  } = useAccountSetup();

  // Email OTP is a migration route now, not a way in. It is the one path that
  // signs an older Consumer in and enrols a passkey on this device, which is
  // exactly what recovering a wallet onto a new phone means.
  const recover = () => router.push("/(auth)/email-login");

  const onPasskey = async () => {
    const outcome = await signIn();
    // The signed-in shell decides where to land; a passkey that worked leaves
    // the session in exactly the state an email code would have.
    if (outcome === "signed-in") router.replace("/(tabs)");
    if (outcome === "no-passkey") setAskingToCreate(true);
  };

  const onCreate = async () => {
    beginPasskeySignup();
    if (!(await signUp())) {
      completePasskeySetup();
      return;
    }
    setAskingToCreate(false);
    // A passkey buys a Privy wallet. Spending from it needs the Account on
    // top, and this is the one moment the fingerprint prompts it costs read as
    // part of signing up rather than as an ambush on an empty dashboard.
    setSettingUpAccount(true);
  };

  // The contact step rather than the app, because it is the last part of
  // signing up. The auth-stack gate is released there, once this screen can no
  // longer be redirected out from under the flow.
  const finishSignup = () => {
    setSettingUpAccount(false);
    router.replace("/add-email");
  };

  const onRunAccountSetup = async () => {
    if (await runAccountSetup()) finishSignup();
  };

  /**
   * Letting them through unfinished is deliberate. They can still receive at
   * their address, and blocking sign-up on a step that can be retried later is
   * worse than the degraded state it protects against.
   */
  const onSkipAccountSetup = () => {
    clearSetupError();
    finishSignup();
  };

  const onRecoverInstead = () => {
    setAskingToCreate(false);
    clearError();
    recover();
  };

  return (
    <View className="flex-1">
      <GradientBackround />

      <View className="flex-1 justify-between border border-green-950 px-8 py-16">
        <View className="h-full flex-1 justify-center">
          <Typography weight="500" className="text-4xl">
            Invest
          </Typography>
        </View>

        <View className="h-full flex-1 justify-end">
          <Logo />
          <Typography
            weight="500"
            className="my-[22px] w-full max-w-[269px] text-4xl text-white"
          >
            Your money, upgraded
          </Typography>
          <View className="mb-10">
            <Typography
              weight="500"
              className="w-full max-w-[311px] text-lg text-[#8FE5F6]"
            >
              Save, earn and invest
            </Typography>
            <Typography
              weight="500"
              className="w-full max-w-[311px] text-lg text-[#8FE5F6]"
            >
              with stablecoins and digital assets.
            </Typography>
          </View>
          <View className="gap-2.5">
            <HapticPressable
              onPress={onPasskey}
              disabled={busy}
              className="w-full flex-row items-center justify-center gap-4 rounded-full border border-white bg-white p-4"
            >
              <Ionicons name="finger-print-outline" size={22} color="#000000" />
              <Typography weight="600" className="text-lg text-black">
                {busy ? "Signing in\u2026" : "Continue with Passkey"}
              </Typography>
            </HapticPressable>

            {passkeyError && (
              <Typography
                weight="500"
                className="px-1 text-sm leading-5 text-[#FFB4AB]"
              >
                {passkeyError}
              </Typography>
            )}

            <HapticPressable
              onPress={recover}
              className="w-full flex-row items-center justify-center gap-3 rounded-full border border-white/20 bg-white/20 p-4"
            >
              <Image
                source={require("@/assets/icons/redo.png")}
                className="size-6"
              />
              <Typography weight="600" className="text-lg text-white">
                Recover existing wallet
              </Typography>
            </HapticPressable>
          </View>
        </View>
      </View>

      <AccountSetupModal
        visible={settingUpAccount}
        stage={setupStage}
        error={setupError}
        onStart={onRunAccountSetup}
        onRetry={onRunAccountSetup}
        onSkip={onSkipAccountSetup}
      />

      <NoPasskeyModal
        visible={askingToCreate}
        onRecover={onRecoverInstead}
        onCreate={onCreate}
        onDismiss={() => {
          setAskingToCreate(false);
          clearError();
        }}
        isCreating={busy}
        error={passkeyError}
      />
    </View>
  );
}

const GradientBackround = () => {
  return (
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
};

export default WithScreenTheme(LoginScreen, {
  backgroundColor: "#FFFFFF",
  textColor: "#000000",
  primaryColor: "#000000",
});
