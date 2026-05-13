import React from "react";
import { View, ViewStyle, TextStyle } from "react-native";
import { Typography } from "./Typography";
import { cn } from "@/utils/cn";

interface ChipProps {
  children: React.ReactNode;
  className?: string;
  textClassName?: string;
  /** @deprecated use className */
  style?: ViewStyle;
  /** @deprecated use textClassName */
  textStyle?: TextStyle;
}

export function Chip({
  children,
  className,
  textClassName,
  style,
  textStyle,
}: ChipProps) {
  return (
    <View
      className={cn(
        "flex-row items-center rounded-full border border-foreground/10 px-3.5 py-2",
        className
      )}
      // MEASURED-LAYOUT
      style={style}
    >
      <Typography className={textClassName} style={textStyle}>
        {children}
      </Typography>
    </View>
  );
}
