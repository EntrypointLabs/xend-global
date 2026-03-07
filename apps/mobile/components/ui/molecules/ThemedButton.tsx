import React from "react";
import {
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  TextStyle,
} from "react-native";
import { Typography } from "../atoms/Typography";
import { useScreenTheme } from "@/contexts/ScreenThemeContext";
import { Spacing } from "@/constants/Spacing";
import tinycolor from "tinycolor2";
import { Size, Weight } from "@/constants/Typography";

interface ThemedButtonProps {
  onPress: () => void;
  title: string;
  variant?: "primary" | "secondary" | "outline";
  style?: ViewStyle;
  textStyle?: TextStyle;
  disabled?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
}

export function ThemedButton({
  onPress,
  title,
  variant = "primary",
  style,
  textStyle,
  disabled = false,
  iconLeft,
  iconRight,
}: ThemedButtonProps) {
  const { primaryColor, backgroundColor, textColor } = useScreenTheme();
  const primaryColorInstance = tinycolor(primaryColor);

  const getButtonStyle = (): ViewStyle => {
    const baseStyle = {
      opacity: disabled ? 0.5 : 1,
    };

    switch (variant) {
      case "primary":
        return {
          ...baseStyle,
          backgroundColor: "#FFFFFF",
          borderColor: "#FFFFFF",
        };
      case "secondary":
        return {
          ...baseStyle,
          backgroundColor: "#000000",
          borderColor: "#000000",
        };
      case "outline":
        return {
          ...baseStyle,
          backgroundColor: "rgba(255, 255, 255, 0.2)",
          borderColor: "rgba(255, 255, 255, 0.2)",
          borderWidth: 1,
        };
      default:
        return {
          ...baseStyle,
          backgroundColor: primaryColor,
          borderColor: primaryColor,
        };
    }
  };

  const getTextColor = (): string => {
    switch (variant) {
      case "primary":
        return "#000000";
      case "secondary":
        return "#FFFFFF";
      case "outline":
        return "#FFFFFF";
      default:
        return "#000000";
    }
  };

  return (
    <TouchableOpacity
      style={[styles.button, getButtonStyle(), style]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      className="flex-row items-center justify-center gap-3"
    >
      {iconLeft}
      <Typography
        weight="600"
        style={[{ color: getTextColor() }, textStyle]}
        className="text-lg"
      >
        {title}
      </Typography>
      {iconRight}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: 20,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
});
