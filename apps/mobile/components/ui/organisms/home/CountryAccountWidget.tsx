import React from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import type { HomeWidget } from "@/utils/homeWidgets";

/** Outer corner radius from the Wise UK reference (~428×387). */
const CARD_RADIUS = 28;
/** Exact Wise UK card crop aspect (~428×387). */
const CARD_ASPECT = 428 / 387;

const PLATE = require("@/assets/images/widgets/united-kingdom-plate.png");

const ACTIONS = [
  { key: "atm", label: "Find an ATM" },
  { key: "convert", label: "Convert price" },
  { key: "split", label: "Split a bill" },
  { key: "more", label: "Do more" },
] as const;

export type CountryWidgetAction = (typeof ACTIONS)[number]["key"];

interface CountryAccountWidgetProps {
  widget: HomeWidget;
  balanceLabel: string;
  onDismiss: () => void;
  onAction?: (action: CountryWidgetAction) => void;
}

/**
 * Wise UK country card — reference plate + live hit targets.
 * Plate is the Wise crop so photo, type, pill, and dock match 1:1;
 * pressables sit on dismiss + the four dock actions.
 */
export function CountryAccountWidget({
  widget,
  balanceLabel,
  onDismiss,
  onAction,
}: CountryAccountWidgetProps) {
  return (
    <View
      style={{
        width: "100%",
        aspectRatio: CARD_ASPECT,
        borderRadius: CARD_RADIUS,
        overflow: "hidden",
        backgroundColor: "#1a1a1a",
      }}
      accessibilityLabel={`${widget.title}, ${balanceLabel} available to spend, ${widget.rateLabel}`}
    >
      <Image
        source={PLATE}
        style={StyleSheet.absoluteFill}
        contentFit="fill"
        cachePolicy="none"
        priority="high"
      />

      <HapticPressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${widget.title} widget`}
        hitSlop={8}
        onPress={onDismiss}
        style={{
          position: "absolute",
          top: "2.5%",
          right: "2.8%",
          width: "7%",
          aspectRatio: 1,
        }}
      />

      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: "2.5%",
          right: "2.5%",
          bottom: "2.2%",
          height: "24%",
          flexDirection: "row",
        }}
      >
        {ACTIONS.map((action) => (
          <HapticPressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={() => onAction?.(action.key)}
            style={{ flex: 1 }}
          />
        ))}
      </View>
    </View>
  );
}
