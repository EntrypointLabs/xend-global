import React from "react";
import { TextProps, TouchableOpacity } from "react-native";
import { Typography } from "./Typography";
import { cn } from "@/utils/cn";

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
        className={cn(
          "text-base text-foreground",
          disabled && "text-foreground/40",
          className
        )}
        {...props}
      >
        {getDisplayText()}
      </Typography>
    </TouchableOpacity>
  );
}
