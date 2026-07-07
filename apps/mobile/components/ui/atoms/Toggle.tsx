import React from "react";
import { Pressable, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { cn } from "@/utils/cn";

interface ToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

export function Toggle({
  value,
  onValueChange,
  disabled = false,
}: ToggleProps) {
  const translateX = useSharedValue(value ? 20 : 0);
  translateX.value = withTiming(value ? 20 : 0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onValueChange(!value);
  };

  return (
    <Pressable onPress={handlePress} disabled={disabled}>
      <View
        className={cn(
          "h-7 w-16 justify-center rounded-full",
          value ? "bg-[#3B82F6]" : "bg-black/10 px-0.5"
        )}
      >
        <Animated.View
          style={animatedStyle}
          className="h-6 w-10 rounded-full bg-white shadow-sm"
        />
      </View>
    </Pressable>
  );
}
