import React from "react";
import {
  StyleSheet,
  View,
  type ColorValue,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { cn } from "@/utils/cn";

/** iOS 26's own material. Older systems and Android keep the solid look. */
export const LIQUID_GLASS = isLiquidGlassAvailable();

/** Lifts clear glass off a white screen, where it would otherwise vanish. */
const LIFT = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 12,
} as const;

/**
 * A tinted button's glow: soft and deeper than the lift, in the button's own
 * colour, so it reads as lit glass rather than a flat fill.
 */
export function glowFor(color: ColorValue) {
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
  } as const;
}

/**
 * What makes tinted glass visible without touching it: light catching the top
 * edge, a bright rim, and the glow. A dark tint swallows the refraction that
 * shows clear glass, so this is what carries it.
 */
export function Sheen() {
  return (
    <View
      pointerEvents="none"
      className="absolute inset-0 overflow-hidden rounded-full border border-white/25"
    >
      <Svg
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        <Defs>
          <LinearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.32} />
            <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={0.06} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100" height="100" fill="url(#sheen)" />
      </Svg>
    </View>
  );
}

/** The solid look a control keeps where liquid glass is not available. */
const SOLID = "bg-card shadow-sm";

function Pane({
  radius,
  tintColor,
  interactive,
}: {
  radius: number;
  tintColor?: ColorValue;
  interactive: boolean;
}) {
  return (
    <GlassView
      glassEffectStyle="regular"
      tintColor={tintColor}
      isInteractive={interactive}
      style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
    />
  );
}

type PressableProps = React.ComponentProps<typeof HapticPressable>;

/**
 * A floating control drawn in liquid glass: back and close buttons, footer
 * actions, anything that sits above the content rather than in it. Content
 * buttons stay solid; glass is for the controls layer only.
 */
export function GlassButton({
  radius,
  tintColor,
  fallbackClassName = SOLID,
  className,
  style,
  children,
  ...pressable
}: Omit<PressableProps, "style" | "children"> & {
  children?: React.ReactNode;
  /** The corner radius of the shape, which the glass must match. */
  radius: number;
  /** Tinted glass also gets a sheen, a rim and a glow in this colour. */
  tintColor?: ColorValue;
  fallbackClassName?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <HapticPressable
      {...pressable}
      className={cn(className, !LIQUID_GLASS && fallbackClassName)}
      style={[
        LIQUID_GLASS ? (tintColor ? glowFor(tintColor) : LIFT) : undefined,
        style,
      ]}
    >
      {LIQUID_GLASS ? (
        <Pane radius={radius} tintColor={tintColor} interactive />
      ) : null}
      {LIQUID_GLASS && tintColor ? <Sheen /> : null}
      {children}
    </HapticPressable>
  );
}

/**
 * Glass behind a group of controls, such as a floating pill holding two
 * actions. The controls inside stay plain: glass is never stacked on glass.
 */
export function GlassSurface({
  radius,
  fallbackClassName = SOLID,
  className,
  style,
  children,
  ...view
}: ViewProps & {
  radius: number;
  fallbackClassName?: string;
  className?: string;
}) {
  return (
    <View
      {...view}
      className={cn(className, !LIQUID_GLASS && fallbackClassName)}
      style={[LIQUID_GLASS ? LIFT : undefined, style]}
    >
      {LIQUID_GLASS ? <Pane radius={radius} interactive={false} /> : null}
      {children}
    </View>
  );
}
