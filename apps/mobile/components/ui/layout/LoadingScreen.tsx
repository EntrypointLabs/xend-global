import React from "react";
import { Image, View } from "react-native";

const splashLogo = require("@/assets/images/splash-icon.png");

// Mirrors the native splash (expo-splash-screen): white background with the
// dark Xend badge centered at the same size, so the handoff from the native
// splash to JS loading states is seamless instead of a white flash + spinner.
function LoadingScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-white">
      <Image source={splashLogo} className="h-40 w-40" resizeMode="contain" />
    </View>
  );
}

export default LoadingScreen;
