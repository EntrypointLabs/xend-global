import React from "react";
import { View, ViewStyle, TextStyle } from "react-native";
import { Typography } from "./Typography";
import { useScreenTheme } from "@/contexts/ScreenThemeContext";
import { cn } from "@/utils/cn";

interface ChipProps {
  children: React.ReactNode;
  className?: string;
  textClassName?: string;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export function Chip({
  children,
  className,
  textClassName,
  style,
  textStyle,
}: ChipProps) {
  const { textColor } = useScreenTheme();

  return (
    <View
      className={cn(
        "flex-row items-center rounded-[20px] border px-3.5 py-2",
        className
      )}
      // DYNAMIC-COLOR (per-screen theme border, 6.25% alpha — matches original "textColor + 10" hex)
      style={[{ borderColor: textColor + "10" }, style]}
    >
      <Typography
        className={textClassName}
        // DYNAMIC-COLOR
        style={[{ color: textColor }, textStyle]}
      >
        {children}
      </Typography>
    </View>
  );
}
