import React from "react";
import { Image, View } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import { WithScreenTheme } from "@/components/WithScreenTheme";
import { router } from "expo-router";
import Logo from "@/components/Logo";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { WordWheel } from "@/components/ui/molecules/WordWheel";
import { Ionicons } from "@expo/vector-icons";

/**
 * The front door, and only for somebody with no session: email signs a new
 * Consumer up and lets an existing one in, and recovery has its own door. No
 * passkey button, on purpose. A Consumer who finished signing up holds a
 * session and never lands here, and one who proves an address that already
 * has an account is offered their passkey right away on the other side.
 */
function LoginScreen() {
  const onEmail = () => router.push("/add-email");
  const onRecover = () => router.push("/(auth)/recover");

  return (
    <View className="flex-1">
      <GradientBackround />

      <View className="flex-1 justify-between px-8 py-16">
        <View className="h-full flex-1 justify-center">
          <WordWheel />
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
              className="w-full flex-row items-center justify-center gap-4 rounded-full border border-white bg-white p-4"
            >
              <Ionicons name="mail-outline" size={22} color="#000000" />
              <Typography weight="600" className="text-lg text-black">
                Continue with email
              </Typography>
            </HapticPressable>

            <HapticPressable
              onPress={onRecover}
              className="w-full flex-row items-center justify-center gap-3 rounded-full border border-white/20 bg-white/20 p-4"
            >
              <Image
                source={require("@/assets/icons/redo.png")}
                className="size-6"
              />
              <Typography weight="600" className="text-lg text-white">
                Recover your account
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
