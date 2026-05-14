import React from "react";
import { View } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import { Ionicons } from "@expo/vector-icons";
import HapticPressable from "../atoms/HapticPressable";
import { useThemeColor } from "@/hooks/useThemeColor";

interface KeypadProps {
  onKeyPress: (key: string) => void;
}

export function Keypad({ onKeyPress }: KeypadProps) {
  const textColor = useThemeColor({}, "text");

  const renderKey = (key: string) => (
    <HapticPressable
      key={key}
      className="m-0.5 flex-1 items-center justify-evenly py-2"
      onPress={() => onKeyPress(key)}
    >
      {key === "backspace" ? (
        <Ionicons name="backspace-outline" size={24} color={textColor} />
      ) : (
        <Typography weight="600" className="text-[26px] text-foreground">
          {key}
        </Typography>
      )}
    </HapticPressable>
  );

  return (
    <View className="w-full p-2">
      <View className="mb-2 flex-row justify-between">
        {renderKey("1")}
        {renderKey("2")}
        {renderKey("3")}
      </View>
      <View className="mb-2 flex-row justify-between">
        {renderKey("4")}
        {renderKey("5")}
        {renderKey("6")}
      </View>
      <View className="mb-2 flex-row justify-between">
        {renderKey("7")}
        {renderKey("8")}
        {renderKey("9")}
      </View>
      <View className="mb-2 flex-row justify-between">
        {renderKey(".")}
        {renderKey("0")}
        {renderKey("backspace")}
      </View>
    </View>
  );
}
