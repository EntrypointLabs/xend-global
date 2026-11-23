import React from "react";
import { View, TouchableOpacity } from "react-native";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { Typography } from "@/components/ui/atoms/Typography";
import { usePalette } from "@/hooks/usePalette";

export function RecipientRow({
  title,
  subtitle,
  onPress,
  icon,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
  icon?: React.ReactNode;
}) {
  const palette = usePalette();
  return (
    <TouchableOpacity
      className="mx-5 mb-4 flex-row items-center"
      onPress={onPress}
    >
      <View className="mr-3 h-12 w-12 items-center justify-center rounded-full border border-[#F2F4F7] bg-gray-200/60 dark:border-foreground/10 dark:bg-muted">
        {icon ?? (
          <MaterialIcons name="wallet" size={22} color={palette.foreground} />
        )}
      </View>
      <View>
        <Typography weight="600" className="text-base text-foreground">
          {title}
        </Typography>
        <Typography weight="500" className="text-sm text-gray-400">
          {subtitle}
        </Typography>
      </View>
    </TouchableOpacity>
  );
}

export function RecipientEmptyState({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  const palette = usePalette();
  return (
    <View className="flex-1 items-center justify-center px-8 pb-24">
      <View className="mb-4 h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-foreground/20">
        <Ionicons name="person" size={20} color={palette.fg(0.25)} />
      </View>
      <Typography
        weight="600"
        className="text-center text-[17px] text-foreground"
      >
        {title}
      </Typography>
      <Typography
        weight="500"
        className="mt-1 text-center text-[15px] text-foreground/30"
      >
        {subtitle}
      </Typography>
    </View>
  );
}
