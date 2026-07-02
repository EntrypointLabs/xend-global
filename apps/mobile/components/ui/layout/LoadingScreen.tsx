import React from "react";
import { Image, View } from "react-native";
import { StatusBar } from "expo-status-bar";

const splashLogo = require("@/assets/images/logo/xend-mark-white-2048.png");

// Mirrors the native splash (expo-splash-screen): pitch-black background with
// the white Xend mark centered at the same size, so the handoff from the
// native splash to JS loading states is seamless instead of a color flash.
function LoadingScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-black">
      <StatusBar style="light" />
      <Image source={splashLogo} className="h-40 w-40" resizeMode="contain" />
    </View>
  );
}

export default LoadingScreen;
