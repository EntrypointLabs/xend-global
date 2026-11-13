import React from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { AuthAtmosphere } from "@/components/ui/molecules/AuthAtmosphere";
import { WithScreenTheme } from "@/components/WithScreenTheme";
import {
  AUTH_BRAND_BLUE,
  AUTH_CANVAS,
  AUTH_CTA,
  AUTH_CTA_LABEL,
} from "@/constants/Colors";

/** Auth primary pills — match add-email / login `h-14` (56pt). */
const AUTH_CTA_HEIGHT = 56;

/**
 * The recovery door. Email is the route that works today: prove the address
 * on the account and the recovery flow takes it from there. A recovery wallet
 * can be added as a key, but signing in with one is not built yet, so that
 * option says so instead of pretending.
 *
 * The email alone opens a session that can look. Taking over on this phone
 * needs a second key as well: the passkey, if it synced here, or a Recovery
 * Key. The copy says so rather than promising the takeover outright.
 */
function RecoverScreen() {
  const insets = useSafeAreaInsets();
  const onEmail = () =>
    router.push({ pathname: "/add-email", params: { intent: "recover" } });
  const onBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(auth)/login");
  };

  return (
    <View className="flex-1" style={{ backgroundColor: AUTH_CANVAS }}>
      <AuthAtmosphere variant="quiet" />
      <View className="flex-1">
        <View className="px-5" style={{ paddingTop: insets.top + 8 }}>
          <HapticPressable
            onPress={onBack}
            feedback="selection"
            className="size-10 items-center justify-center rounded-full bg-white/10"
            accessibilityLabel="Back to login"
            hitSlop={8}
          >
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
          </HapticPressable>
        </View>

        <View
          className="flex-1 justify-end px-8"
          style={{ paddingBottom: Math.max(insets.bottom, 16) + 24 }}
        >
          <Typography weight="600" className="mb-3 text-3xl text-white">
            Recover your account
          </Typography>
          <Typography
            weight="400"
            className="mb-8 text-base leading-6 text-white/50"
          >
            Lost your phone or moved to a new one? Prove the email on your
            account to get back in. Paired with your passkey or a second
            Recovery Key, this phone can take over, after a one day delay that
            keeps anyone else from doing the same.
          </Typography>

          <View className="gap-2.5">
            <HapticPressable
              onPress={onEmail}
              className="h-14 w-full flex-row items-center justify-center gap-4 rounded-full px-4"
              style={{ backgroundColor: AUTH_CTA, height: AUTH_CTA_HEIGHT }}
            >
              <Ionicons name="mail-outline" size={22} color={AUTH_CTA_LABEL} />
              <Typography
                weight="600"
                className="text-lg"
                style={{ color: AUTH_CTA_LABEL }}
              >
                Recover with email
              </Typography>
            </HapticPressable>

            <View
              className="h-14 w-full flex-row items-center justify-center gap-4 rounded-full border border-white/20 bg-white/10 px-4 opacity-50"
              style={{ height: AUTH_CTA_HEIGHT }}
            >
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
          </View>
        </View>
      </View>
    </View>
  );
}

export default WithScreenTheme(RecoverScreen, {
  backgroundColor: AUTH_CANVAS,
  textColor: "#FFFFFF",
  primaryColor: AUTH_BRAND_BLUE,
});
