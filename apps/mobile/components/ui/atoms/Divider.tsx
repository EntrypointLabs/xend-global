import React, { useState, useCallback } from "react";
import { View, LayoutChangeEvent } from "react-native";
import { useScreenTheme } from "@/contexts/ScreenThemeContext";
import tinycolor from "tinycolor2";
import { cn } from "@/utils/cn";

type DividerType = "dashed" | "dotted" | "solid";

interface DividerProps {
  className?: string;
  color?: string;
  thickness?: number;
  dashLength?: number;
  dashGap?: number;
  type?: DividerType;
}

export function Divider({
  className,
  color,
  thickness = 1,
  dashLength = 8,
  dashGap = 8,
  type = "dashed",
}: DividerProps) {
  const { textColor } = useScreenTheme();
  const [width, setWidth] = useState(0);

  const dividerColor =
    color || tinycolor(textColor).setAlpha(0.2).toRgbString();

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

  if (type === "solid") {
    return (
      <View
        className={cn("my-6 w-full", className)}
        // DYNAMIC-COLOR (per-screen theme via useScreenTheme)
        style={{ height: thickness, backgroundColor: dividerColor }}
      />
    );
  }

  const spacing =
    type === "dotted" ? thickness * 2 + dashGap : dashLength + dashGap;
  const numberOfItems = Math.floor(width / spacing);

  return (
    <View
      onLayout={onLayout}
      // MEASURED-LAYOUT
      style={{ height: type === "dotted" ? thickness * 2 : thickness }}
      className={cn("my-6 w-full", className)}
      collapsable={false}
    >
      {width > 0 && (
        <View className="h-full flex-row items-center">
          {Array.from({ length: numberOfItems }, (_, i) => (
            // DYNAMIC-COLOR + MEASURED-LAYOUT
            <View
              key={i}
              style={
                type === "dotted"
                  ? {
                      width: thickness * 2,
                      height: thickness * 2,
                      borderRadius: thickness,
                      marginRight: dashGap,
                      backgroundColor: dividerColor,
                    }
                  : {
                      width: dashLength,
                      height: thickness,
                      marginRight: dashGap,
                      backgroundColor: dividerColor,
                    }
              }
            />
          ))}
        </View>
      )}
    </View>
  );
}
