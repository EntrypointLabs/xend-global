import React, { isValidElement } from "react";
import { View, Image, ImageSourcePropType } from "react-native";
import { Typography } from "../atoms/Typography";
import { Ionicons } from "@expo/vector-icons";
import HapticPressable from "../atoms/HapticPressable";

interface SettingsItemProps {
  icon: ImageSourcePropType | React.ReactNode;
  label: string;
  onPress?: () => void;
  showChevron?: boolean;
  color?: string;
}

export function SettingsItem({
  icon,
  label,
  onPress,
  showChevron = true,
  color,
}: SettingsItemProps) {
  return (
    <HapticPressable
      onPress={onPress}
      className="flex-row items-center gap-4 bg-transparent py-4"
    >
      <View className="size-6 items-center justify-center">
        {isValidElement(icon) ? (
          icon
        ) : (
          <Image
            source={icon as ImageSourcePropType}
            className="size-6"
            resizeMode="contain"
          />
        )}
      </View>

      <View className="flex-1">
        <Typography
          weight="500"
          className="text-lg text-black"
          style={{ color }}
        >
          {label}
        </Typography>
      </View>
      {showChevron && (
        <Ionicons name="chevron-forward" size={20} className="!text-black/40" />
      )}
    </HapticPressable>
  );
}
