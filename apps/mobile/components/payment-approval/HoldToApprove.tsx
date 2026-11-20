import React, { useRef, useState } from "react";
import { Animated, Easing, Pressable, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import { Typography } from "@/components/ui/atoms/Typography";

/**
 * Long enough that a pocket or a stray thumb cannot approve a Payment, short
 * enough that a deliberate press does not feel like waiting.
 */
const HOLD_MS = 850;
const TICKS = [0.33, 0.66];

/**
 * A press that has to be held to approve. Tapping does nothing but nudge the
 * fill, which is how the control teaches itself.
 *
 * Plain Animated rather than Reanimated: an animated style alongside
 * NativeWind's className is what overflows the stack in HapticPressable.
 */
export function HoldToApprove({
  label,
  onApprove,
  disabled,
}: {
  label: string;
  onApprove: () => void;
  disabled?: boolean;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  const ticked = useRef(new Set<number>());
  const listener = useRef<string | null>(null);

  const stopListening = () => {
    if (listener.current) progress.removeListener(listener.current);
    listener.current = null;
  };

  const pressIn = () => {
    if (disabled) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    ticked.current.clear();
    stopListening();
    listener.current = progress.addListener(({ value }) => {
      for (const tick of TICKS) {
        if (value >= tick && !ticked.current.has(tick)) {
          ticked.current.add(tick);
          void Haptics.selectionAsync();
        }
      }
    });
    progress.stopAnimation((from) => {
      Animated.timing(progress, {
        toValue: 1,
        duration: HOLD_MS * (1 - from),
        easing: Easing.linear,
        useNativeDriver: true,
      }).start(({ finished }) => {
        stopListening();
        if (!finished) return;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        onApprove();
        progress.setValue(0);
      });
    });
  };

  const pressOut = () => {
    stopListening();
    progress.stopAnimation((value) => {
      if (value >= 1) return;
      Animated.spring(progress, {
        toValue: 0,
        speed: 22,
        bounciness: 0,
        useNativeDriver: true,
      }).start();
    });
  };

  const fill = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-width, 0],
  });

  return (
    <Pressable
      onPressIn={pressIn}
      onPressOut={pressOut}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Press and hold to approve this payment"
      accessibilityState={{ disabled: !!disabled }}
      // A hold is hard with VoiceOver or Switch Control; activation is the
      // same deliberate act there.
      accessibilityActions={[{ name: "activate" }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "activate" && !disabled) onApprove();
      }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      className="h-16 w-full overflow-hidden rounded-full bg-[#0E0F0C]"
    >
      <Animated.View
        pointerEvents="none"
        className="absolute inset-y-0 left-0 w-full rounded-full bg-white/25"
        style={{ transform: [{ translateX: fill }] }}
      />
      <View
        pointerEvents="none"
        className="flex-1 flex-row items-center justify-center gap-2.5"
      >
        <Ionicons name="finger-print" size={20} color="#fff" />
        <Typography weight="600" className="text-[16px] text-white">
          {label}
        </Typography>
      </View>
    </Pressable>
  );
}
