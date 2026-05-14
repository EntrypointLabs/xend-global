import React from "react";
import { View } from "react-native";
import { ThemedText } from "@/components/ui/atoms";
import { useScreenTheme } from "@/contexts/ScreenThemeContext";
import { cn } from "@/utils/cn";

interface ScreenHeaderTextProps {
  title: string;
  subtitle?: string;
  flex?: number;
}

export function ScreenHeaderText({
  title,
  subtitle,
  flex,
}: ScreenHeaderTextProps) {
  const { textColor } = useScreenTheme();

  return (
    <View
      className="mb-8 mt-[60px] items-center"
      // MEASURED-LAYOUT
      style={flex ? { flex } : undefined}
    >
      <ThemedText
        className={cn("mb-2")}
        type="highlight"
        // DYNAMIC-COLOR
        style={{ color: textColor }}
      >
        {title}
      </ThemedText>
      {subtitle && (
        <ThemedText
          type="default"
          // DYNAMIC-COLOR
          style={{ color: textColor }}
        >
          {subtitle}
        </ThemedText>
      )}
    </View>
  );
}
