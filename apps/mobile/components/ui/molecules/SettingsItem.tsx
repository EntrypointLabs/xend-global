import React, { isValidElement } from "react";
import { View, Image, ImageSourcePropType } from "react-native";
import { Typography } from "../atoms/Typography";
import { Ionicons } from "@expo/vector-icons";
import HapticPressable from "../atoms/HapticPressable";
import { GLASS_COLORS, useOnPhoto } from "@/components/ui/glass";
import { cn } from "@/utils/cn";

interface SettingsItemProps {
  icon: ImageSourcePropType | React.ReactNode;
  label: string;
  onPress?: () => void;
  showChevron?: boolean;
  color?: string;
  /** Tint a black glyph white on the photo. Coloured glyphs keep their colour. */
  tintOnPhoto?: boolean;
}

export function SettingsItem({
  icon,
  label,
  onPress,
  showChevron = true,
  color,
  tintOnPhoto = false,
}: SettingsItemProps) {
  const onPhoto = useOnPhoto();

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
            tintColor={onPhoto && tintOnPhoto ? "#FFFFFF" : undefined}
          />
        )}
      </View>

      <View className="flex-1">
        <Typography
          weight="500"
          className={cn("text-lg", onPhoto ? "text-white" : "text-black")}
          // Only when set: an undefined `color` in the style still overrides
          // the class colour and turns the label black on the photo.
          style={color ? { color } : undefined}
        >
          {label}
        </Typography>
      </View>
      {showChevron &&
        (onPhoto ? (
          <Ionicons
            name="chevron-forward"
            size={20}
            color={GLASS_COLORS.small}
          />
        ) : (
          <Ionicons
            name="chevron-forward"
            size={20}
            className="!text-black/40"
          />
        ))}
    </HapticPressable>
  );
}
