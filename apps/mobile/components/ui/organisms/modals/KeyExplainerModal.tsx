import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { ActionModal } from "../ActionModal";

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

interface KeyExplainerModalProps {
  visible: boolean;
  onClose: () => void;
  subject: ExplainedKey;
}

export function KeyExplainerModal({
  visible,
  onClose,
  subject,
}: KeyExplainerModalProps) {
  const explainer = EXPLAINERS[subject];

  return (
    <ActionModal visible={visible} onClose={onClose}>
      <View className="mb-6 items-center">
        <View className="mb-5 size-12 items-center justify-center rounded-2xl bg-black">
          <Ionicons name={explainer.icon} size={24} color="#FFFFFF" />
        </View>
        <Typography weight="600" className="text-base">
          {explainer.title}
        </Typography>
      </View>

      <View className="gap-5">
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

      <HapticPressable
        onPress={onClose}
        className="mt-6 h-14 items-center justify-center rounded-full bg-black/5"
        accessibilityRole="button"
      >
        <Typography weight="600" className="text-base text-black">
          Got it
        </Typography>
      </HapticPressable>
    </ActionModal>
  );
}
