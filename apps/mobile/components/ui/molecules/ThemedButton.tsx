import React from "react";
import { TouchableOpacity, ViewStyle, TextStyle } from "react-native";
import { Typography } from "../atoms/Typography";
import { useScreenTheme } from "@/contexts/ScreenThemeContext";
import { cn } from "@/utils/cn";

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

const variantBg: Record<NonNullable<ThemedButtonProps["variant"]>, string> = {
  primary: "bg-white border-white",
  secondary: "bg-black border-black",
  outline: "bg-white/20 border border-white/20",
};

const variantText: Record<NonNullable<ThemedButtonProps["variant"]>, string> = {
  primary: "text-black",
  secondary: "text-white",
  outline: "text-white",
};

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
  useScreenTheme(); // Preserved subscription for deferred ScreenThemeContext removal (ADR-0007).

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      className={cn(
        "w-full flex-row items-center justify-center gap-3 rounded-[42px] p-5",
        variantBg[variant],
        disabled && "opacity-50"
      )}
      // MEASURED-LAYOUT
      style={style}
    >
      {iconLeft}
      <Typography
        weight="600"
        className={cn("text-lg", variantText[variant])}
        style={textStyle}
      >
        {title}
      </Typography>
      {iconRight}
    </TouchableOpacity>
  );
}
