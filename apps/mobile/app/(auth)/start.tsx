import React, { useEffect } from "react";
import { useRouter } from "expo-router";
import { WithScreenTheme } from "@/components/WithScreenTheme";
import { useAuth } from "@/contexts/AuthContext";
import { View } from "react-native";

export function StartScreen() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/(tabs)");
    }
  }, [isLoading]);

  if (isLoading) {
    return null;
  }

  return <View />;
}

export default WithScreenTheme(StartScreen);
