import type { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";
import * as Haptics from "expo-haptics";
import { Pressable, type PressableProps } from "react-native";

export function HapticTab(props: BottomTabBarButtonProps) {
  // BottomTabBarButtonProps carries web-only/navigation fields that RN's
  // Pressable doesn't type; the runtime-relevant props (onPress*, style,
  // children, accessibility*) are a strict subset, so the cast is safe.
  return (
    <Pressable
      {...(props as PressableProps)}
      onPressIn={(ev) => {
        if (process.env.EXPO_OS === "ios") {
          // Add a soft haptic feedback when pressing down on the tabs.
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        props.onPressIn?.(ev);
      }}
    />
  );
}
