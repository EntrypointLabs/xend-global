import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
} from "react-native-reanimated";
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
  /** iOS 26 liquid glass where the system has it; for floating chrome. */
  liquid?: boolean;
  /** Folded to the active item alone; tapping it calls `onExpand`. */
  collapsed?: boolean;
  onExpand?: () => void;
}

const SOLID_SHADOW = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.1,
  shadowRadius: 16,
  elevation: 6,
};

/** Lifts clear glass off a white screen, where it would otherwise vanish. */
const LIQUID_SHADOW = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 12,
};

/** iOS 26's own material. Older systems and Android keep the drawn one. */
const LIQUID_AVAILABLE = isLiquidGlassAvailable();

const FOLD = LinearTransition.springify().damping(20).stiffness(220);

export function ActionPill({
  items,
  containerStyle,
  variant = "solid",
  liquid: wantsLiquid = false,
  collapsed = false,
  onExpand,
}: ActionPillProps) {
  const glass = variant === "glass";
  const liquid = wantsLiquid && LIQUID_AVAILABLE;
  const shown = collapsed
    ? items.filter((item) => item.isActive).slice(0, 1)
    : items;

  return (
    <Animated.View
      layout={FOLD}
      className={cn(
        "flex-row items-center rounded-full",
        liquid
          ? undefined
          : glass
            ? "overflow-hidden border border-white/[0.18]"
            : "overflow-hidden border border-black/5 bg-white"
      )}
      // PLATFORM-SHADOW
      style={[
        liquid
          ? glass
            ? undefined
            : LIQUID_SHADOW
          : glass
            ? undefined
            : SOLID_SHADOW,
        containerStyle,
      ]}
    >
      {liquid ? (
        <GlassView
          glassEffectStyle="regular"
          colorScheme={glass ? "dark" : "light"}
          isInteractive
          style={[StyleSheet.absoluteFill, { borderRadius: 999 }]}
        />
      ) : (
        glass && (
          <>
            <BlurView
              intensity={40}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
            <View className="absolute inset-0 bg-white/10" />
          </>
        )
      )}
      {shown.map((item, index) => {
        const Icon = item.icon;
        const isFirst = index === 0;
        const isLast = index === shown.length - 1;
        return (
          <Animated.View
            key={item.testID ?? index}
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(120)}
          >
            <HapticPressable
              accessibilityRole="button"
              accessibilityState={item.isActive ? { selected: true } : {}}
              accessibilityLabel={
                collapsed ? "Show tabs" : item.accessibilityLabel
              }
              testID={item.testID}
              onPress={collapsed && onExpand ? onExpand : item.onPress}
              onLongPress={item.onLongPress}
              // The former container padding + gap live inside each item, so every
              // pressable fills its slice of the pill (padding and half the gap
              // included) and a tap near the icon — not just on it — registers.
              className={cn(
                // 50pt tall, the height of the round action button beside it.
                "items-center justify-center py-[13px]",
                collapsed
                  ? "px-[13px]"
                  : isFirst && isLast
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
          </Animated.View>
        );
      })}
    </Animated.View>
  );
}
