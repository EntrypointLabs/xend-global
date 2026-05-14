import React from "react";
import { TextProps, TouchableOpacity } from "react-native";
import { Typography } from "./Typography";
import { useScreenTheme } from "@/contexts/ScreenThemeContext";

interface ThemedActionTextProps extends Omit<TextProps, "style"> {
  onPress?: () => void;
  disabled?: boolean;
  countdown?: number;
  disabledText?: string;
  activeText?: string;
  className?: string;
}

export function ThemedActionText({
  onPress,
  disabled = false,
  countdown,
  disabledText = "Resend code",
  activeText = "Resend code",
  className,
  ...props
}: ThemedActionTextProps) {
  const { textColor } = useScreenTheme();

  const getDisplayText = () => {
    if (disabled && countdown !== undefined) {
      return `${disabledText} ${countdown}s`;
    }
    return activeText;
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      className="items-center justify-center"
    >
      <Typography
        weight="500"
        className={className}
        // DYNAMIC-COLOR (per-screen theme via useScreenTheme; "60" hex alpha = ~37.6%)
        style={{
          fontSize: 16,
          color: disabled ? textColor + "60" : textColor,
        }}
        {...props}
      >
        {getDisplayText()}
      </Typography>
    </TouchableOpacity>
  );
}
