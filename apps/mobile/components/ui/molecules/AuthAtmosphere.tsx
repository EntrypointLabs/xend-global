import React, { useEffect } from "react";
import { Dimensions, Image, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

import { AUTH_BRAND_BLUE, AUTH_CANVAS } from "@/constants/Colors";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

/** prydd.co landscape used for “Life, meets savings” body scenes. */
const LIFE_SCENE = require("@/assets/images/auth/life-meets-savings.jpg");
/** prydd.co sky landscape — expansive wash for “Crypto, in the same account”. */
const CRYPTO_SCENE = require("@/assets/images/auth/crypto-same-account.jpg");

const SCENE_SWAP_MS = 9000;
const KEN_BURNS_MS = 22000;
const BLOOM_MS = 7000;
const PULSE_MS = 5500;

type Variant = "hero" | "quiet";

/**
 * Shared dark-door atmosphere for auth screens.
 *
 * Plasma: lifestyle stills at the top that dissolve into black.
 * Aave: soft blue presence as a faint bloom, never a solid field.
 * Motion is slow opacity/scale only — no video dependency.
 *
 * Landscape never wipes to pure black: life stays as an opaque base,
 * crypto overlays on top, and a soft pulse only dims slightly.
 */
export function AuthAtmosphere({ variant = "hero" }: { variant?: Variant }) {
  const reduceMotion = useReducedMotion();
  const sceneSwap = useSharedValue(0);
  const drift = useSharedValue(0);
  const bloom = useSharedValue(0.4);
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) return;

    // Soft overlay swap — crypto fades in/out over an always-visible base.
    sceneSwap.value = withRepeat(
      withSequence(
        withTiming(1, {
          duration: SCENE_SWAP_MS,
          easing: Easing.inOut(Easing.sin),
        }),
        withTiming(0, {
          duration: SCENE_SWAP_MS,
          easing: Easing.inOut(Easing.sin),
        })
      ),
      -1,
      false
    );

    drift.value = withRepeat(
      withSequence(
        withTiming(1, {
          duration: KEN_BURNS_MS,
          easing: Easing.inOut(Easing.quad),
        }),
        withTiming(0, {
          duration: KEN_BURNS_MS,
          easing: Easing.inOut(Easing.quad),
        })
      ),
      -1,
      false
    );

    // Extremely quiet bloom breathe — barely perceptible.
    bloom.value = withDelay(
      400,
      withRepeat(
        withSequence(
          withTiming(0.55, {
            duration: BLOOM_MS,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(0.3, {
            duration: BLOOM_MS,
            easing: Easing.inOut(Easing.sin),
          })
        ),
        -1,
        false
      )
    );

    // Soft beam/pulse: dim slightly, then return — never blackout.
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.82, {
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.sin),
        }),
        withTiming(1, {
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.sin),
        })
      ),
      -1,
      false
    );
  }, [reduceMotion, sceneSwap, drift, bloom, pulse]);

  const photoHeight = variant === "hero" ? SCREEN_H * 0.58 : SCREEN_H * 0.38;
  // Solid canvas band overlapping the photo clip. Without this, iOS draws a
  // bright hairline where overflow:hidden meets the door — on hero that seam
  // sits right under the login logo (quiet clips higher, so it rarely shows).
  const seamCoverTop = photoHeight * 0.78;
  const seamCoverHeight = photoHeight - seamCoverTop + 24;

  // Life stays fully opaque as the base layer so the canvas never shows through.
  const lifeStyle = useAnimatedStyle(() => ({
    opacity: pulse.value,
    transform: [
      { scale: interpolate(drift.value, [0, 1], [1.04, 1.12]) },
      {
        translateY: interpolate(drift.value, [0, 1], [0, -12]),
      },
    ],
  }));

  // Crypto overlays on top (0 → ~0.88), never exposing black underneath.
  const cryptoStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sceneSwap.value, [0, 1], [0, 0.88]) * pulse.value,
    transform: [
      { scale: interpolate(drift.value, [0, 1], [1.1, 1.04]) },
      {
        translateX: interpolate(drift.value, [0, 1], [-8, 6]),
      },
    ],
  }));

  // Effective opacity ≈ bloomSV * multiplier → hero ~0.024–0.044, quiet ~0.015–0.028
  const bloomStyle = useAnimatedStyle(() => ({
    opacity: bloom.value * (variant === "hero" ? 0.08 : 0.05),
  }));

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: AUTH_CANVAS }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <View style={{ height: photoHeight, overflow: "hidden" }}>
        <Animated.Image
          source={LIFE_SCENE}
          style={[styles.photo, lifeStyle]}
          resizeMode="cover"
        />
        {!reduceMotion ? (
          <Animated.Image
            source={CRYPTO_SCENE}
            style={[styles.photo, cryptoStyle]}
            resizeMode="cover"
          />
        ) : null}

        {/* Darken the stills so white type stays legible over them. */}
        <View style={[StyleSheet.absoluteFill, styles.photoVeil]} />

        <Svg
          width={SCREEN_W}
          height={photoHeight}
          style={StyleSheet.absoluteFill}
        >
          <Defs>
            <LinearGradient id="authPhotoFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={AUTH_CANVAS} stopOpacity="0.15" />
              <Stop offset="0.4" stopColor={AUTH_CANVAS} stopOpacity="0.22" />
              <Stop offset="0.62" stopColor={AUTH_CANVAS} stopOpacity="0.7" />
              {/* Full canvas well before the clip — leftover photo luminance
                  at the overflow edge is what read as the login hairline. */}
              <Stop offset="0.78" stopColor={AUTH_CANVAS} stopOpacity="1" />
              <Stop offset="1" stopColor={AUTH_CANVAS} stopOpacity="1" />
            </LinearGradient>
          </Defs>
          <Rect
            x="0"
            y="0"
            width={SCREEN_W}
            height={photoHeight}
            fill="url(#authPhotoFade)"
          />
        </Svg>
      </View>

      <View
        style={{
          position: "absolute",
          top: seamCoverTop,
          left: 0,
          right: 0,
          height: seamCoverHeight,
          backgroundColor: AUTH_CANVAS,
        }}
      />

      {/* Soft brand bloom — blue as atmosphere, not a CTA. Extremely faint. */}
      <Animated.View style={[styles.bloomWrap, bloomStyle]}>
        <Svg width={SCREEN_W * 1.4} height={SCREEN_H * 0.7}>
          <Defs>
            <RadialGradient id="authBloom" cx="50%" cy="45%" r="50%">
              <Stop offset="0" stopColor={AUTH_BRAND_BLUE} stopOpacity="0.12" />
              <Stop
                offset="0.45"
                stopColor={AUTH_BRAND_BLUE}
                stopOpacity="0.04"
              />
              <Stop offset="1" stopColor={AUTH_BRAND_BLUE} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect
            x="0"
            y="0"
            width={SCREEN_W * 1.4}
            height={SCREEN_H * 0.7}
            fill="url(#authBloom)"
          />
        </Svg>
      </Animated.View>

      {/* Feathered brand wash near the actions — almost imperceptible. */}
      <Image
        source={require("@/assets/images/onboarding/blue-blur-1.png")}
        style={[
          styles.floorGlow,
          { opacity: variant === "hero" ? 0.04 : 0.025 },
        ]}
        resizeMode="stretch"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  photo: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  photoVeil: {
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  bloomWrap: {
    position: "absolute",
    top: SCREEN_H * 0.18,
    left: -SCREEN_W * 0.2,
    width: SCREEN_W * 1.4,
    height: SCREEN_H * 0.7,
  },
  floorGlow: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -40,
    height: SCREEN_H * 0.55,
    width: "100%",
  },
});
