import React from "react";
import { View } from "react-native";
import { CircleButton } from "./CircleButton";

interface ButtonItem {
  icon: React.ComponentProps<typeof CircleButton>["icon"];
  label: string;
  onPress: () => void;
  color?: string;
  textColor?: string;
}

interface CircleButtonGroupProps {
  buttons: ButtonItem[];
}

export function CircleButtonGroup({ buttons }: CircleButtonGroupProps) {
  return (
    <View className="flex-row items-center justify-evenly py-2">
      {buttons.map((button, index) => (
        <View key={index} className="w-[75px] items-center justify-center">
          <CircleButton
            icon={button.icon}
            label={button.label}
            onPress={button.onPress}
            backgroundColor={button.color}
            customTextColor={button.textColor}
          />
        </View>
      ))}
    </View>
  );
}
