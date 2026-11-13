import React from "react";
import { Image, View } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import { WithScreenTheme } from "@/components/WithScreenTheme";
import { router } from "expo-router";
import Logo from "@/components/Logo";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { AuthAtmosphere } from "@/components/ui/molecules/AuthAtmosphere";
import { WordWheel } from "@/components/ui/molecules/WordWheel";
import { Ionicons } from "@expo/vector-icons";
import {
  AUTH_BRAND_BLUE,
  AUTH_CANVAS,
  AUTH_CTA,
  AUTH_CTA_LABEL,
} from "@/constants/Colors";

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
    <View className="flex-1" style={{ backgroundColor: AUTH_CANVAS }}>
      <AuthAtmosphere variant="hero" />
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
              className="w-full max-w-[311px] text-lg text-white/50"
            >
              Save, earn and invest
            </Typography>
            <Typography
              weight="500"
              className="w-full max-w-[311px] text-lg text-white/50"
            >
              with stablecoins and digital assets.
            </Typography>
          </View>
          <View className="gap-2.5">
            <HapticPressable
              onPress={onEmail}
              className="h-14 w-full flex-row items-center justify-center gap-4 rounded-full px-4"
              style={{ backgroundColor: AUTH_CTA, height: 56 }}
            >
              <Ionicons name="mail-outline" size={22} color={AUTH_CTA_LABEL} />
              <Typography
                weight="600"
                className="text-lg"
                style={{ color: AUTH_CTA_LABEL }}
              >
                Continue with email
              </Typography>
            </HapticPressable>

            <HapticPressable
              onPress={onRecover}
              className="h-14 w-full flex-row items-center justify-center gap-3 rounded-full border border-white/20 bg-white/20 px-4"
              style={{ height: 56 }}
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

export default WithScreenTheme(LoginScreen, {
  backgroundColor: AUTH_CANVAS,
  textColor: "#FFFFFF",
  primaryColor: AUTH_BRAND_BLUE,
});
