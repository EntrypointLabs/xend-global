import React, { createContext, useContext } from "react";
import { Image, StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

/**
 * The prydd.co "Life, meets savings" look: a landscape under a dark veil, with
 * translucent white cards. Every value here is read off the website's own
 * stylesheet so the app and the site match.
 *
 * Note the site's card has no backdrop blur. The glass is only a 10% white
 * fill and an 18% white hairline, which is also far cheaper on a phone.
 */
export const GLASS = {
  card: "rounded-[16px] border border-white/[0.18] bg-white/10",
  divider: "border-white/[0.12]",
  chip: "bg-white/[0.12]",
  /** Outline pill, `--pill-stroke: #ffffff38`. */
  outlinePill: "border border-white/[0.22]",
  ink: "text-white",
  copy: "text-white/[0.82]",
  caption: "text-white/[0.66]",
  small: "text-white/[0.56]",
  /**
   * The app's success and destructive hues with only the lightness raised
   * (49% to 64%, 59% to 72%): the stock tokens are too dark to read on the veil.
   */
  up: "text-[#63E483]",
  down: "text-[#FF7A70]",
  upFill: "bg-[#63E483]/20",
  downFill: "bg-[#FF7A70]/20",
} as const;

export const GLASS_COLORS = {
  ink: "#FFFFFF",
  caption: "rgba(255,255,255,0.66)",
  small: "rgba(255,255,255,0.56)",
  chip: "rgba(255,255,255,0.12)",
} as const;

/** True inside a screen drawn over the photo backdrop. */
const OnPhotoContext = createContext(false);
export const OnPhotoProvider = OnPhotoContext.Provider;
export function useOnPhoto(): boolean {
  return useContext(OnPhotoContext);
}

const FIELD = require("@/assets/images/auth/life-meets-savings.jpg");

/** `#050505` under the photo and `rgb(26,33,39)` while it loads, as on the site. */
export function PhotoBackdrop() {
  const { width, height } = useWindowDimensions();
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: "#050505" }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Image
        source={FIELD}
        resizeMode="cover"
        style={[StyleSheet.absoluteFill, { backgroundColor: "rgb(26,33,39)" }]}
      />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="veilV" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000" stopOpacity="0.85" />
            <Stop offset="0.38" stopColor="#000" stopOpacity="0.36" />
            <Stop offset="0.62" stopColor="#000" stopOpacity="0.25" />
            <Stop offset="1" stopColor="#000" stopOpacity="0.76" />
          </LinearGradient>
          <LinearGradient id="veilH" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#000" stopOpacity="0.35" />
            <Stop offset="1" stopColor="#000" stopOpacity="0.1" />
          </LinearGradient>
        </Defs>
        <Rect width={width} height={height} fill="url(#veilV)" />
        <Rect width={width} height={height} fill="url(#veilH)" />
      </Svg>
    </View>
  );
}
