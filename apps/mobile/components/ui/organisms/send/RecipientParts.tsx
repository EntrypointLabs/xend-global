import React from "react";
import { View, TouchableOpacity } from "react-native";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { Typography } from "@/components/ui/atoms/Typography";

export function RecipientRow({
  title,
  subtitle,
  onPress,
  icon = <MaterialIcons name="wallet" size={22} color="black" />,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <TouchableOpacity
      className="mx-5 mb-4 flex-row items-center"
      onPress={onPress}
    >
      <View
        className="mr-3 h-12 w-12 items-center justify-center rounded-full border bg-gray-200/60"
        style={{ borderColor: "#F2F4F7" }}
      >
        {icon}
      </View>
      <View>
        <Typography weight="600" className="text-base">
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
  return (
    <View className="flex-1 items-center justify-center px-8 pb-24">
      <View className="mb-4 h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-black/20">
        <Ionicons name="person" size={20} color="rgba(0,0,0,0.25)" />
      </View>
      <Typography weight="600" className="text-center text-[17px] text-black">
        {title}
      </Typography>
      <Typography
        weight="500"
        className="mt-1 text-center text-[15px] text-black/30"
      >
        {subtitle}
      </Typography>
    </View>
  );
}
