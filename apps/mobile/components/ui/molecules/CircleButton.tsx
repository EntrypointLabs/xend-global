import React from "react";
import { TouchableOpacity, View } from "react-native";
import { Typography } from "../atoms/Typography";
import { Ionicons } from "@expo/vector-icons";
import { useThemeColor } from "@/hooks/useThemeColor";

interface CircleButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  size?: number;
  backgroundColor?: string;
  iconColor?: string;
  disabled?: boolean;
  customTextColor?: string;
}

export function CircleButton({
  icon,
  label,
  onPress,
  size = 45,
  backgroundColor: customBackgroundColor,
  iconColor: customIconColor,
  disabled = false,
  customTextColor,
}: CircleButtonProps) {
  const themeBackgroundColor = useThemeColor({}, "primary");
  const themeIconColor = useThemeColor({}, "background");

  const backgroundColor = customBackgroundColor || themeBackgroundColor;
  const buttonTextColor = customIconColor || themeIconColor;

  const textColor = useThemeColor({}, "text");
  const shadowColor = useThemeColor({}, "border");

  return (
    <View className="items-center text-center">
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        className="items-center justify-center rounded-full"
        // DYNAMIC-COLOR (theme-derived backgroundColor + shadowColor + opacity)
        style={{
          width: size,
          height: size,
          backgroundColor,
          shadowColor,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
          elevation: 3,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Ionicons name={icon} size={size * 0.5} color={buttonTextColor} />
      </TouchableOpacity>
      {label && (
        <Typography
          weight="500"
          className="mt-1 text-xs"
          // DYNAMIC-COLOR
          style={{ color: customTextColor || textColor }}
        >
          {label}
        </Typography>
      )}
    </View>
  );
}
