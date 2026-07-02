import React from "react";
import { View, StyleSheet } from "react-native";
import { ThemedScreen, StarburstFull } from "@/components/ui/layout";
import { ThemedText, IconSymbol } from "@/components/ui/atoms";
import { ThemedButton } from "@/components/ui/molecules";
import { WithScreenTheme } from "@/components/WithScreenTheme";
import { useScreenTheme } from "@/contexts/ScreenThemeContext";

interface FaceIDScreenProps {
  show2FA: boolean;
}

/** NOT USED */
export function FaceIDScreen({ show2FA }: FaceIDScreenProps) {
  const { textColor } = useScreenTheme();

  const handleEnable2FA = () => {
    // TODO: Implement Face ID/2FA logic or navigation
  };

  return (
    <ThemedScreen className="flex-1">
      <StarburstFull
        primaryColor="#0080FF"
        opacity={0.7}
        // MEASURED-LAYOUT
        style={StyleSheet.absoluteFill}
      />
      <View className="flex-1 items-center justify-center px-6">
        <IconSymbol name="faceid" size={64} color={textColor} />
        <ThemedText type="default" className="mb-6 mt-4 text-center">
          Enable Face ID to{"\n"}protect your account
        </ThemedText>
        {show2FA && (
          <ThemedButton
            title="Enable 2FA"
            onPress={handleEnable2FA}
            // MEASURED-LAYOUT
            style={{ width: 150 }}
          />
        )}
      </View>
    </ThemedScreen>
  );
}

export default WithScreenTheme(FaceIDScreen, {
  backgroundColor: "#000000",
  textColor: "#FFFFFF",
  primaryColor: "#FFFFFF",
});
