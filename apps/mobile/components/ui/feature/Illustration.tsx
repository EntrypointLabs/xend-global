import React from "react";
import { View, type ImageSourcePropType } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

/**
 * Every illustration a feature page can lead with. A name maps to its render
 * once the art exists; a new name can map to null and the slot holds a quiet
 * placeholder of the same size, so a page can be laid out before its art lands.
 * How the renders are made is in assets/illustrations/source.
 */
const ART: Record<IllustrationName, ImageSourcePropType | null> = {
  jar: require("@/assets/illustrations/jar.webp"),
  group: require("@/assets/illustrations/group.webp"),
  calendar: require("@/assets/illustrations/calendar.webp"),
  split: require("@/assets/illustrations/split.webp"),
  convert: require("@/assets/illustrations/convert.webp"),
  atm: require("@/assets/illustrations/atm.webp"),
  error: require("@/assets/illustrations/error.webp"),
  // Stands in until its own render is made: the convert coin already reads
  // as money changing form.
  deposit: require("@/assets/illustrations/convert.webp"),
};

export type IllustrationName =
  | "jar"
  | "group"
  | "calendar"
  | "split"
  | "convert"
  | "atm"
  | "error"
  | "deposit";

export function Illustration({
  name,
  size,
}: {
  name: IllustrationName;
  size: number;
}) {
  const source = ART[name];
  if (source) {
    return (
      <Image
        source={source}
        style={{ width: size, height: size }}
        contentFit="contain"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    );
  }
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="items-center justify-center rounded-[36px] border border-dashed border-black/15 bg-black/[0.03]"
      style={{ width: size, height: size }}
    >
      <Ionicons name="image-outline" size={size * 0.18} color="#0000002E" />
    </View>
  );
}
