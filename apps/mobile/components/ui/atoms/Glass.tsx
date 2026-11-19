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

/** The solid look a control keeps where liquid glass is not available. */
const SOLID = "bg-white shadow-sm";

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
  tintColor?: ColorValue;
  fallbackClassName?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <HapticPressable
      {...pressable}
      className={cn(className, !LIQUID_GLASS && fallbackClassName)}
      style={[LIQUID_GLASS ? LIFT : undefined, style]}
    >
      {LIQUID_GLASS ? (
        <Pane radius={radius} tintColor={tintColor} interactive />
      ) : null}
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
