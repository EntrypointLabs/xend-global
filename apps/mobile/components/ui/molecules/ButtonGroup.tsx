import React from "react";
import { View, ViewStyle, StyleProp } from "react-native";
import { ThemedButton } from "./ThemedButton";

interface ButtonGroupProps {
  leftTitle: string;
  leftOnPress: () => void;
  rightTitle: string;
  rightOnPress: () => void;
  leftVariant?: "primary" | "secondary" | "outline";
  rightVariant?: "primary" | "secondary" | "outline";
  className?: string;
  style?: StyleProp<ViewStyle>;
}

export function ButtonGroup({
  leftTitle,
  leftOnPress,
  rightTitle,
  rightOnPress,
  leftVariant = "primary",
  rightVariant = "secondary",
  className,
  style,
}: ButtonGroupProps) {
  return (
    <View
      className={`flex-row justify-between gap-3 ${className ?? ""}`}
      style={style}
    >
      <ThemedButton
        title={leftTitle}
        onPress={leftOnPress}
        variant={leftVariant}
        style={{ flex: 1 }}
      />
      <ThemedButton
        title={rightTitle}
        onPress={rightOnPress}
        variant={rightVariant}
        style={{ flex: 1 }}
      />
    </View>
  );
}
