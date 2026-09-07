import React from "react";
import { Image, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { WithScreenTheme } from "@/components/WithScreenTheme";

/**
 * The recovery door. Email is the route that works today: prove the address
 * on the account and the restore flow takes it from there. A recovery wallet
 * can be added as a key, but signing in with one is not built yet, so that
 * option says so instead of pretending.
 */
function RecoverScreen() {
  const onEmail = () =>
    router.push({ pathname: "/add-email", params: { intent: "recover" } });

  return (
    <View className="flex-1">
      <GradientBackground />

      <View className="flex-1 justify-end px-8 py-16">
        <Typography weight="600" className="mb-3 text-3xl text-white">
          Recover your account
        </Typography>
        <Typography
          weight="400"
          className="mb-8 text-base leading-6 text-[#8FE5F6]"
        >
          Lost your phone or moved to a new one? Prove the email on your account
          and this phone can take over, with a one day delay that keeps anyone
          else from doing the same.
        </Typography>

        <View className="gap-2.5">
          <HapticPressable
            onPress={onEmail}
            className="w-full flex-row items-center justify-center gap-4 rounded-full bg-white p-4"
          >
            <Ionicons name="mail-outline" size={22} color="#000000" />
            <Typography weight="600" className="text-lg text-black">
              Recover with email
            </Typography>
          </HapticPressable>

          <View className="w-full flex-row items-center justify-center gap-4 rounded-full border border-white/20 bg-white/10 p-4 opacity-50">
            <Ionicons name="wallet-outline" size={22} color="#FFFFFF" />
            <Typography weight="600" className="text-lg text-white">
              Recover with wallet
            </Typography>
          </View>
          <Typography
            weight="400"
            className="text-center text-sm text-white/60"
          >
            Not available yet. If you added a recovery wallet, email still
            works.
          </Typography>

          <HapticPressable
            onPress={() => router.back()}
            className="mt-2 items-center p-2"
          >
            <Typography weight="500" className="text-base text-white">
              Back
            </Typography>
          </HapticPressable>
        </View>
      </View>
    </View>
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

export default WithScreenTheme(RecoverScreen, {
  backgroundColor: "#000000",
  textColor: "#FFFFFF",
  primaryColor: "#FFFFFF",
});
