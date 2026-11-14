import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { cn } from "@/utils/cn";

export interface ActionPillItem {
  icon: React.FC<{
    isActive?: boolean;
    size?: number;
    tone?: "dark" | "light";
  }>;
  label?: string;
  onPress: () => void;
  onLongPress?: () => void;
  isActive?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

export interface ActionPillProps {
  items: ActionPillItem[];
  containerStyle?: StyleProp<ViewStyle>;
  /**
   * `glass` is the prydd.co card material for screens on the photo: a 10%
   * white fill and an 18% white hairline. It adds a dark blur the site's
   * static cards do not need, because this one floats over scrolling content
   * and the icons must stay legible whatever passes under it.
   */
  variant?: "solid" | "glass";
}

const SOLID_SHADOW = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.1,
  shadowRadius: 16,
  elevation: 6,
};

export function ActionPill({
  items,
  containerStyle,
  variant = "solid",
}: ActionPillProps) {
  const glass = variant === "glass";

  return (
    <View
      className={cn(
        "flex-row items-center rounded-full",
        glass
          ? "overflow-hidden border border-white/[0.18]"
          : "border border-black/5 bg-white"
      )}
      // PLATFORM-SHADOW
      style={[glass ? undefined : SOLID_SHADOW, containerStyle]}
    >
      {glass && (
        <>
          <BlurView
            intensity={40}
            tint="dark"
            style={StyleSheet.absoluteFill}
          />
          <View className="absolute inset-0 bg-white/10" />
        </>
      )}
      {items.map((item, index) => {
        const Icon = item.icon;
        const isFirst = index === 0;
        const isLast = index === items.length - 1;
        return (
          <HapticPressable
            key={index}
            accessibilityRole="button"
            accessibilityState={item.isActive ? { selected: true } : {}}
            accessibilityLabel={item.accessibilityLabel}
            testID={item.testID}
            onPress={item.onPress}
            onLongPress={item.onLongPress}
            // The former container padding + gap live inside each item, so every
            // pressable fills its slice of the pill (padding and half the gap
            // included) and a tap near the icon — not just on it — registers.
            className={cn(
              "items-center justify-center py-3",
              isFirst && isLast
                ? "px-5"
                : isFirst
                  ? "pl-5 pr-3.5"
                  : isLast
                    ? "pl-3.5 pr-5"
                    : "px-3.5"
            )}
          >
            <Icon
              isActive={item.isActive}
              size={24}
              tone={glass ? "light" : "dark"}
            />
          </HapticPressable>
        );
      })}
    </View>
  );
}
