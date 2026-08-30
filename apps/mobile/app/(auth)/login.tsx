import React, { useState } from "react";
import { Image, View } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import { WithScreenTheme } from "@/components/WithScreenTheme";
import { router } from "expo-router";
import Logo from "@/components/Logo";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Ionicons } from "@expo/vector-icons";
import { usePasskeyLogin } from "@/hooks/usePasskeyLogin";

/**
 * The front door. Email leads because it works on any device, including one
 * that holds no passkey yet, which on a fresh install is every device. The
 * passkey stays right beneath it because on a phone that has one it is the
 * faster way in, and a returning Consumer should not have to look for it.
 */
function LoginScreen() {
  const { signIn, busy, error: passkeyError, clearError } = usePasskeyLogin();
  const [noPasskey, setNoPasskey] = useState(false);

  // Email OTP is a migration route now, not a way in. It is the one path that
  // signs an older Consumer in and enrols a passkey on this device, which is
  // exactly what recovering a wallet onto a new phone means.
  const recover = () => router.push("/(auth)/email-login");

  const onEmail = () => {
    clearError();
    setNoPasskey(false);
    router.push("/add-email");
  };

  const onPasskey = async () => {
    setNoPasskey(false);
    const outcome = await signIn();
    // The signed-in shell decides where to land; a passkey that worked leaves
    // the session in exactly the state an email code would have.
    if (outcome === "signed-in") router.replace("/(tabs)");
    // Not a failure and not an offer to create anything: a passkey from
    // another ecosystem looks the same as none at all, and the email door
    // above is the one that works for both.
    if (outcome === "no-passkey") setNoPasskey(true);
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
              onPress={onEmail}
              disabled={busy}
              className="w-full flex-row items-center justify-center gap-4 rounded-full border border-white bg-white p-4"
            >
              <Ionicons name="mail-outline" size={22} color="#000000" />
              <Typography weight="600" className="text-lg text-black">
                Continue with email
              </Typography>
            </HapticPressable>

            <HapticPressable
              onPress={onPasskey}
              disabled={busy}
              className="w-full flex-row items-center justify-center gap-4 rounded-full border border-white bg-transparent p-4"
            >
              <Ionicons name="finger-print-outline" size={22} color="#FFFFFF" />
              <Typography weight="600" className="text-lg text-white">
                {busy ? "Signing in…" : "Sign in with passkey"}
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
            {noPasskey && !passkeyError && (
              <Typography
                weight="500"
                className="px-1 text-sm leading-5 text-white/80"
              >
                No passkey on this phone yet. Continue with email to create one,
                or to reach an account you made elsewhere.
              </Typography>
            )}

            <HapticPressable
              onPress={recover}
              disabled={busy}
              className="w-full flex-row items-center justify-center gap-3 p-3"
            >
              <Image
                source={require("@/assets/icons/redo.png")}
                className="size-5"
              />
              <Typography weight="600" className="text-base text-white/90">
                Recover existing wallet
              </Typography>
            </HapticPressable>
          </View>
        </View>
      </View>
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
