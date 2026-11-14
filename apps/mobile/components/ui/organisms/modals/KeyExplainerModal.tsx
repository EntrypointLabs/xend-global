import React, { forwardRef, useCallback, useMemo } from "react";
import { View } from "react-native";
import {
  BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { Ionicons } from "@expo/vector-icons";

import { BlurBackdrop } from "@/components/ui/molecules/BlurBackdrop";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";

export type ExplainedKey = "passkey" | "device" | "recovery";

interface KeyPoint {
  icon: keyof typeof Ionicons.glyphMap;
  heading: string;
  body: string;
}

/**
 * What each key is, in the Consumer's terms.
 *
 * The distinction the copy has to carry is Active versus Recovery: an Active
 * Key approves payments, a Recovery Key only ever helps restore an Account and
 * can never move money on its own. Getting that wrong would have someone treat
 * a recovery key as a spare way to spend.
 */
const EXPLAINERS: Record<
  ExplainedKey,
  { title: string; icon: keyof typeof Ionicons.glyphMap; points: KeyPoint[] }
> = {
  passkey: {
    title: "What's a Passkey?",
    icon: "finger-print-outline",
    points: [
      {
        icon: "flash-outline",
        heading: "Active Key",
        body: "Approves the payments you make every day.",
      },
      {
        icon: "lock-closed-outline",
        heading: "Secure",
        body: "Unlocked by your face, fingerprint or screen lock. It never leaves your device.",
      },
      {
        icon: "refresh-outline",
        heading: "Recovery",
        body: "If you lose it, your Device Key and a Recovery Key can restore access.",
      },
    ],
  },
  device: {
    title: "What's a Device Key?",
    icon: "phone-portrait-outline",
    points: [
      {
        icon: "flash-outline",
        heading: "Active Key",
        body: "Approves payments above your spending limit.",
      },
      {
        icon: "hardware-chip-outline",
        heading: "Made by this phone",
        body: "Created inside this phone's secure hardware, and it cannot be copied off it.",
      },
      {
        icon: "refresh-outline",
        heading: "Recovery",
        body: "If you lose this phone, your Passkey and a Recovery Key can restore access.",
      },
    ],
  },
  recovery: {
    title: "What's a Recovery Key?",
    icon: "key-outline",
    points: [
      {
        icon: "refresh-outline",
        heading: "Account recovery",
        body: "Restores your account when paired with one Active Key. You can have up to three.",
      },
      {
        icon: "shield-checkmark-outline",
        heading: "Recovery only",
        body: "A Recovery Key can never move money on its own, or alongside another Recovery Key.",
      },
      {
        icon: "time-outline",
        heading: "Takes a day",
        body: "Adding or removing one waits out a security delay, so a change you did not make can be stopped.",
      },
    ],
  },
};

interface KeyExplainerSheetProps {
  subject: ExplainedKey;
}

export const KeyExplainerSheet = forwardRef<
  BottomSheetModal,
  KeyExplainerSheetProps
>(({ subject }, ref) => {
  const snapPoints = useMemo(() => ["72%"], []);
  const explainer = EXPLAINERS[subject];

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => <BlurBackdrop {...props} />,
    []
  );

  const dismiss = () => {
    // @ts-ignore - ref forwarded from parent
    ref?.current?.dismiss();
  };

  return (
    <BottomSheetModal
      ref={ref}
      index={0}
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      handleIndicatorStyle={{ backgroundColor: "#00000026" }}
    >
      <BottomSheetView className="flex-1 px-6 pb-8">
        <View className="items-center pt-2">
          <View className="size-14 items-center justify-center rounded-2xl bg-black">
            <Ionicons name={explainer.icon} size={26} color="#FFFFFF" />
          </View>
          <Typography weight="700" className="mt-4 text-2xl text-black">
            {explainer.title}
          </Typography>
        </View>

        <View className="mt-7 gap-6">
          {explainer.points.map((point) => (
            <View key={point.heading} className="flex-row gap-3">
              <View className="mt-0.5 size-5 items-center justify-center">
                <Ionicons name={point.icon} size={16} color="#000000" />
              </View>
              <View className="flex-1">
                <Typography weight="600" className="text-base text-black">
                  {point.heading}
                </Typography>
                <Typography
                  weight="400"
                  className="mt-1 text-base leading-6 text-black/50"
                >
                  {point.body}
                </Typography>
              </View>
            </View>
          ))}
        </View>

        <View className="min-h-6 flex-1" />

        <HapticPressable
          onPress={dismiss}
          className="h-14 items-center justify-center rounded-full bg-black/5"
          accessibilityRole="button"
        >
          <Typography weight="600" className="text-base text-black">
            Got it
          </Typography>
        </HapticPressable>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

KeyExplainerSheet.displayName = "KeyExplainerSheet";
