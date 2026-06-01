import React from "react";
import { Image, View } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import { WithScreenTheme } from "@/components/WithScreenTheme";
import { router } from "expo-router";
import Logo from "@/components/Logo";
import HapticPressable from "@/components/ui/atoms/HapticPressable";

function LoginScreen() {
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
            {/* <ThemedButton
              onPress={() => authenticate("")}
              title="Continue with Google"
              iconLeft={
                <Image
                  source={require("@/assets/icons/google.png")}
                  className="size-6"
                />
              }
            /> */}
            <HapticPressable
              onPress={() => router.push("/(auth)/email-login")}
              className="w-full flex-row items-center justify-center gap-4 rounded-full border border-white bg-white p-4"
            >
              <Image
                source={require("@/assets/icons/google.png")}
                className="size-6"
              />
              <Typography weight="600" className="text-lg text-black">
                Continue with Email
              </Typography>
            </HapticPressable>
            <HapticPressable
              onPress={() => router.push("/(auth)/restore-account")}
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
            {/* <ThemedButton
              onPress={() => {}}
              variant="outline"
              title="Recover existing wallet"
              iconLeft={
                <Image
                  source={require("@/assets/icons/redo.png")}
                  className="size-6"
                />
              }
            /> */}
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
