import React from "react";
import { View, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/ui/atoms";

interface PromoBannerProps {
  title: string;
  description: string;
  onPress?: () => void;
  onClose?: () => void;
  visible?: boolean;
}

export function PromoBanner({
  title,
  description,
  onPress,
  onClose,
  visible = true,
}: PromoBannerProps) {
  if (!visible) return null;

  const shadowStyle = {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  };

  return (
    <TouchableOpacity
      className="mb-4 mt-auto flex-row items-center justify-between rounded-[20px] border border-black/[0.05] bg-white p-4"
      // PLATFORM-SHADOW
      style={shadowStyle}
      onPress={onPress}
      activeOpacity={0.9}
    >
      <View className="flex-1 flex-row items-center">
        <View className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-info">
          <Ionicons name="home" size={20} color="white" />
        </View>
        <View className="flex-1 gap-0.5">
          <ThemedText type="defaultSemiBold" className="text-[15px] text-black">
            {title}
          </ThemedText>
          <ThemedText type="small" className="text-black opacity-50">
            {description}
          </ThemedText>
        </View>
      </View>

      <TouchableOpacity
        onPress={onClose}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="close" size={16} color="#000" className="opacity-40" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}
