import React from "react";
import { StyleSheet } from "react-native";
import { BottomSheetBackdropProps, useBottomSheet } from "@gorhom/bottom-sheet";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
} from "react-native-reanimated";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { FrostBlurView } from "@/components/ui/atoms/FrostBlurView";

/**
 * A gorhom bottom-sheet backdrop with the same frosted blur as the modals.
 * Fades with the sheet position and taps to close.
 *
 * The blur lives in a plain FrostBlurView; the fade is on a wrapping
 * Animated.View. Animating the BlurView wrapper directly (via
 * createAnimatedComponent) drops the blur on both platforms.
 */
export function BlurBackdrop({
  animatedIndex,
  style,
}: BottomSheetBackdropProps) {
  const { close } = useBottomSheet();

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      animatedIndex.value,
      [-1, 0],
      [0, 1],
      Extrapolation.CLAMP
    ),
  }));

  return (
    <Animated.View style={[style, animatedStyle]}>
      <FrostBlurView style={StyleSheet.absoluteFill}>
        <HapticPressable className="flex-1" onPress={() => close()} />
      </FrostBlurView>
    </Animated.View>
  );
}
