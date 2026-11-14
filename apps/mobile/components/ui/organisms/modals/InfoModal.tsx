import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { ActionModal } from "../ActionModal";

interface InfoModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  description: React.ReactNode;
  iconName: keyof typeof Ionicons.glyphMap;
  iconBackground: string;
  iconColor?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function InfoModal({
  visible,
  onClose,
  title,
  description,
  iconName,
  iconBackground,
  iconColor = "#FFFFFF",
  actionLabel = "Got it",
  onAction,
}: InfoModalProps) {
  const handleAction = () => {
    onAction?.();
    onClose();
  };

  return (
    <ActionModal visible={visible} onClose={onClose}>
      <View className="mb-5 items-center">
        <View
          className="mb-5 h-12 w-12 items-center justify-center rounded-2xl"
          style={{ backgroundColor: iconBackground }}
        >
          <Ionicons name={iconName} size={24} color={iconColor} />
        </View>
        <Typography weight="600" className="text-base">
          {title}
        </Typography>
      </View>

      <View className="mb-6 gap-3">
        {typeof description === "string" ? (
          <Typography
            weight="400"
            className="text-center text-base leading-6 text-black/50"
          >
            {description}
          </Typography>
        ) : (
          description
        )}
      </View>

      <HapticPressable
        onPress={handleAction}
        className="items-center justify-center rounded-full bg-black/5 py-4"
      >
        <Typography weight="600" className="text-base text-black">
          {actionLabel}
        </Typography>
      </HapticPressable>
    </ActionModal>
  );
}
