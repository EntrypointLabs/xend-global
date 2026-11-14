import React, { createContext, useContext } from "react";
import { Image, StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { BlurView } from "expo-blur";
import { ScreenLayout } from "@/components/ui/layout/ScreenLayout";
import { useColorfulTheme } from "@/contexts/AppearanceContext";

/** How hard a blurred backdrop is softened. Retune it here for every tab. */
const PHOTO_BLUR = 40;

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

// Soft shadow that lifts a monochrome card off the white page. iOS reads the
// shadow* props and Android only `elevation`, so these are style objects.
const RAISED = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.09,
  shadowRadius: 14,
  elevation: 3,
};
const RAISED_DARK = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.28,
  shadowRadius: 12,
  elevation: 6,
};

/** One theme's surface and text values, keyed the same in both themes. */
export interface Surface {
  card: string;
  /** Lift for `card`: a shadow on white, nothing on the photo. */
  raised: object | undefined;
  divider: string;
  chip: string;
  ink: string;
  copy: string;
  caption: string;
  small: string;
  up: string;
  down: string;
  upFill: string;
  downFill: string;
  primaryButton: string;
  primaryButtonText: string;
  primaryRaised: object | undefined;
  secondaryButton: string;
  secondaryButtonText: string;
  /** A low-emphasis pill such as "Add widgets". */
  quietPill: string;
  /** Padding and figure size of the Cash and Crypto tiles. */
  tile: string;
  tileAmount: string;
  colors: { ink: string; caption: string; small: string; chip: string };
}

const PHOTO_SURFACE: Surface = {
  ...GLASS,
  raised: undefined,
  // The site's CTA is a solid white pill with black type; its secondary
  // pills are a white hairline on the photo.
  primaryButton: "bg-white",
  primaryButtonText: "text-black",
  primaryRaised: undefined,
  secondaryButton: GLASS.outlinePill,
  secondaryButtonText: "text-white",
  quietPill: GLASS.outlinePill,
  tile: "p-[18px]",
  tileAmount: "text-[22px] tracking-[-0.9px]",
  colors: GLASS_COLORS,
};

const MONO_SURFACE: Surface = {
  card: "rounded-2xl bg-card",
  raised: RAISED,
  divider: "border-black/[0.06]",
  chip: "bg-black/5",
  ink: "text-black",
  copy: "text-black/40",
  caption: "text-black/40",
  small: "text-black/30",
  up: "text-success",
  down: "text-destructive",
  upFill: "bg-success/10",
  downFill: "bg-destructive/10",
  primaryButton: "bg-black",
  primaryButtonText: "text-white",
  primaryRaised: RAISED_DARK,
  secondaryButton: "bg-white",
  secondaryButtonText: "text-black",
  quietPill: "bg-black/5",
  tile: "px-4 py-4",
  tileAmount: "text-lg",
  colors: {
    ink: "#000000",
    caption: "#00000066",
    small: "#0000004D",
    chip: "rgba(0,0,0,0.05)",
  },
};

/**
 * The surface for wherever the caller is: glass on the photo, the white app
 * everywhere else, including a monochrome tab root.
 */
export function useSurface(): Surface {
  return surfaceFor(useOnPhoto());
}

/** The surface for a screen that sets the photo context itself. */
export function surfaceFor(onPhoto: boolean): Surface {
  return onPhoto ? PHOTO_SURFACE : MONO_SURFACE;
}

/**
 * The routes drawn on a photo in the colorful theme: the three tab roots.
 * Settings sub-pages are still white screens. Shared by the tab bar and the
 * status bar so the two cannot disagree about which screens are dark.
 */
export function isPhotoRoute(
  segments: readonly string[],
  colorful: boolean
): boolean {
  if (!colorful) return false;
  if (segments[0] !== "(tabs)") return false;
  const tab = segments[1];
  if (tab === undefined || tab === "history") return true;
  return tab === "settings" && segments[2] === undefined;
}

/** True inside a screen drawn over the photo backdrop. */
const OnPhotoContext = createContext(false);
export const OnPhotoProvider = OnPhotoContext.Provider;
export function useOnPhoto(): boolean {
  return useContext(OnPhotoContext);
}

/**
 * The website's three backdrops: `landscape-field`, `landscape-sky` and
 * `landscape-shore`. One per tab, so each tab reads as its own place.
 */
const SCENES = {
  field: require("@/assets/images/auth/life-meets-savings.jpg"),
  sky: require("@/assets/images/auth/crypto-same-account.jpg"),
  shore: require("@/assets/images/auth/shore.jpg"),
} as const;

export type PhotoScene = keyof typeof SCENES;

/**
 * Classes that join consecutive rows into one glass card: rounded ends on the
 * first and last, side borders throughout, a 12% hairline between rows.
 */
export function groupedRowClass(index: number, count: number): string {
  const first = index === 0;
  const last = index === count - 1;
  return [
    "border-x border-white/[0.18] bg-white/10 px-4",
    first ? "rounded-t-[16px] border-t" : "",
    last ? "rounded-b-[16px] border-b" : "",
  ].join(" ");
}

/** `#050505` under the photo and `rgb(26,33,39)` while it loads, as on the site. */
export function PhotoBackdrop({
  scene = "field",
  warm = false,
  blurred = false,
}: {
  scene?: PhotoScene;
  /** An amber wash over the photo, for a golden-hour version of a scene. */
  warm?: boolean;
  /** Soften the photo so it reads as atmosphere behind a list. */
  blurred?: boolean;
}) {
  const { width, height } = useWindowDimensions();
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: "#050505" }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Image
        source={SCENES[scene]}
        resizeMode="cover"
        style={[StyleSheet.absoluteFill, { backgroundColor: "rgb(26,33,39)" }]}
      />
      {blurred && (
        <BlurView
          intensity={PHOTO_BLUR}
          tint="default"
          style={StyleSheet.absoluteFill}
        />
      )}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="veilV" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000" stopOpacity="0.85" />
            <Stop offset="0.38" stopColor="#000" stopOpacity="0.36" />
            <Stop offset="0.62" stopColor="#000" stopOpacity="0.25" />
            <Stop offset="1" stopColor="#000" stopOpacity="0.76" />
          </LinearGradient>
          {/* Under the veil, so the dark ends stay dark and the warmth sits
              in the open middle where the photo shows. */}
          <LinearGradient id="warm" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FF9A3C" stopOpacity="0.12" />
            <Stop offset="0.6" stopColor="#FF8A3D" stopOpacity="0.32" />
            <Stop offset="1" stopColor="#E0603A" stopOpacity="0.28" />
          </LinearGradient>
          <LinearGradient id="veilH" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#000" stopOpacity="0.35" />
            <Stop offset="1" stopColor="#000" stopOpacity="0.1" />
          </LinearGradient>
        </Defs>
        {warm && <Rect width={width} height={height} fill="url(#warm)" />}
        <Rect width={width} height={height} fill="url(#veilV)" />
        <Rect width={width} height={height} fill="url(#veilH)" />
      </Svg>
    </View>
  );
}

/**
 * A tab root. In the colorful theme it sits on its photo, with the photo
 * context set for everything in it; each tab picks its own scene, the way
 * Revolut changes the backdrop per tab under the same glass. In the
 * monochrome theme it is a plain white ScreenLayout.
 */
export function PhotoScreen({
  scene,
  warm,
  blurred,
  children,
}: {
  scene: PhotoScene;
  warm?: boolean;
  blurred?: boolean;
  children: React.ReactNode;
}) {
  const colorful = useColorfulTheme();
  if (!colorful) {
    return (
      <OnPhotoProvider value={false}>
        <ScreenLayout>{children}</ScreenLayout>
      </OnPhotoProvider>
    );
  }
  return (
    <OnPhotoProvider value>
      <View className="flex-1">
        <PhotoBackdrop scene={scene} warm={warm} blurred={blurred} />
        <ScreenLayout lightColor="transparent">{children}</ScreenLayout>
      </View>
    </OnPhotoProvider>
  );
}
