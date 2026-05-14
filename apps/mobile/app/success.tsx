import React from "react";
import { TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { ThemedText, IconSymbol } from "@/components/ui/atoms";
import { StarburstFull, ThemedScreen } from "@/components/ui/layout";
import { useScreenTheme } from "@/contexts/ScreenThemeContext";
import { WithScreenTheme } from "@/components/WithScreenTheme";

export function SuccessScreen() {
  const { primaryColor } = useScreenTheme();

  const handleContinue = () => {
    router.replace("/(tabs)");
  };

  return (
    <ThemedScreen className="flex-1">
      <StarburstFull
        primaryColor="#00FF80"
        opacity={0.7}
        // MEASURED-LAYOUT
        style={{ position: "absolute", width: "100%", height: "100%" }}
      />
      <TouchableOpacity
        className="flex-1 items-center justify-center px-6"
        onPress={handleContinue}
        activeOpacity={0.8}
      >
        <IconSymbol
          name="checkmark.circle"
          size={80}
          color={primaryColor}
          style={{ marginBottom: 16 }}
        />
        <ThemedText type="default" className="opacity-70">
          All done!
        </ThemedText>
      </TouchableOpacity>
    </ThemedScreen>
  );
}

export default WithScreenTheme(SuccessScreen, {
  backgroundColor: "#000000",
  textColor: "#FFFFFF",
  primaryColor: "#FFFFFF",
});
