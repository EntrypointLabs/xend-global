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

function LoginScreen() {
  const {
    signIn,
    signUp,
    busy,
    error: passkeyError,
    clearError,
  } = usePasskeyLogin();
  const [askingToCreate, setAskingToCreate] = useState(false);

  // Email OTP is a migration route now, not a way in. It is the one path that
  // signs an older Consumer in and enrols a passkey on this device, which is
  // exactly what recovering a wallet onto a new phone means.
  const recover = () => router.push("/(auth)/email-login");

  /**
   * Creating an account has its own way in, rather than only appearing when a
   * sign-in fails.
   *
   * On a device holding no credential for the relying party, Android does not
   * answer `NoCredentials`: it offers to sign in from another device instead,
   * and a Consumer who backs out of that gets a cancellation. So the path that
   * revealed "create an account" was unreachable for exactly the person who
   * needed it, which on a fresh install is everyone.
   */
  const onPasskey = async () => {
    const outcome = await signIn();
    // The signed-in shell decides where to land; a passkey that worked leaves
    // the session in exactly the state an email code would have.
    if (outcome === "signed-in") router.replace("/(tabs)");
    if (outcome === "no-passkey") setAskingToCreate(true);
  };

  const onCreate = async () => {
    if (!(await signUp())) return;
    setAskingToCreate(false);
    // The contact step, and the Account is built from there. It has to be:
    // the recovery signer is anchored on the Consumer's address, so there is
    // no Account to create until they have given one. The shell routes here on
    // its own once the session exists, and this makes it immediate rather than
    // leaving a frame of dashboard in between.
    router.replace("/add-email");
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

            <HapticPressable
              onPress={() => setAskingToCreate(true)}
              disabled={busy}
              className="w-full items-center p-3"
            >
              <Typography weight="600" className="text-base text-white/90">
                New here? Create an account
              </Typography>
            </HapticPressable>
          </View>
        </View>
      </View>

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
