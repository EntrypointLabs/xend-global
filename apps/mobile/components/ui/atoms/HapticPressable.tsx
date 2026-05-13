import React from "react";
import { Pressable, PressableProps } from "react-native";
import * as Haptics from "expo-haptics";

interface HapticPressableProps extends PressableProps {
  className?: string;
}

const HapticPressable = (props: HapticPressableProps) => {
  return (
    <Pressable
      {...props}
      onPress={(event) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        props.onPress?.(event);
      }}
      onLongPress={(event) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        props.onLongPress?.(event);
      }}
    >
      {props.children}
    </Pressable>
  );
};

export default HapticPressable;
