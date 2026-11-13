import React from "react";
import { TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/components/ui/atoms/Typography";
import { ThemedScreen } from "@/components/ui/layout";

export default function SuccessScreen() {
  const handleContinue = () => {
    router.replace("/(tabs)");
  };

  return (
    <ThemedScreen className="flex-1">
      <TouchableOpacity
        className="flex-1 items-center justify-center px-6"
        onPress={handleContinue}
        activeOpacity={0.8}
      >
        <Ionicons name="checkmark-circle-outline" size={80} color="black" />
        <Typography weight="500" className="mt-4 text-black/60">
          All done!
        </Typography>
      </TouchableOpacity>
    </ThemedScreen>
  );
}
