import React, { useState, useCallback } from "react";
import { View, LayoutChangeEvent } from "react-native";
import { cn } from "@/utils/cn";

type DividerType = "dashed" | "dotted" | "solid";

interface DividerProps {
  className?: string;
  /** @deprecated Pass `className` instead. Kept for backward compat during refactor. */
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
  const [width, setWidth] = useState(0);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

  if (type === "solid") {
    return (
      // MEASURED-LAYOUT
      <View
        className={cn("my-4 w-full", !color && "bg-foreground/20", className)}
        style={
          color
            ? { height: thickness, backgroundColor: color }
            : { height: thickness }
        }
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
      className={cn("my-4 w-full", className)}
      collapsable={false}
    >
      {width > 0 && (
        <View className="h-full flex-row items-center">
          {Array.from({ length: numberOfItems }, (_, i) => (
            <View
              key={i}
              className={cn(!color && "bg-foreground/20")}
              // MEASURED-LAYOUT
              style={
                type === "dotted"
                  ? {
                      width: thickness * 2,
                      height: thickness * 2,
                      borderRadius: thickness,
                      marginRight: dashGap,
                      ...(color ? { backgroundColor: color } : {}),
                    }
                  : {
                      width: dashLength,
                      height: thickness,
                      marginRight: dashGap,
                      ...(color ? { backgroundColor: color } : {}),
                    }
              }
            />
          ))}
        </View>
      )}
    </View>
  );
}
