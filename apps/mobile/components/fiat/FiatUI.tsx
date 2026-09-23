import React from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Pressable,
  TextInput,
  type TextInputProps,
  View,
  type ViewProps,
} from "react-native";
import { router } from "expo-router";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { cn } from "@/utils/cn";

export function FiatHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <View className="mb-2 gap-5">
      <HapticPressable
        accessibilityLabel="Go back"
        className="h-12 w-12 items-center justify-center rounded-full bg-black/5"
        onPress={() => router.back()}
      >
        <Ionicons name="chevron-back" size={22} color="black" />
      </HapticPressable>
      <View className="gap-1.5">
        <Typography weight="700" className="text-[32px] tracking-[-0.8px]">
          {title}
        </Typography>
        {subtitle ? (
          <Typography
            weight="500"
            className="text-base leading-6 text-black/40"
          >
            {subtitle}
          </Typography>
        ) : null}
      </View>
    </View>
  );
}

export function FiatNotice({ children }: { children: React.ReactNode }) {
  return (
    <View className="flex-row gap-3 rounded-[20px] bg-[#FFF8E7] p-4">
      <Ionicons name="shield-checkmark-outline" size={20} color="#9A6700" />
      <Typography weight="500" className="flex-1 leading-5 text-[#725100]">
        {children}
      </Typography>
    </View>
  );
}

export function FiatCard({ className, ...props }: ViewProps) {
  return (
    <View
      className={cn(
        "rounded-[24px] border border-black/10 bg-white p-5",
        className
      )}
      {...props}
    />
  );
}

export function FiatTextInput({ className, ...props }: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor="#0000004D"
      className={cn(
        "rounded-2xl border border-black/10 bg-black/[0.025] px-4 py-4 text-base text-black",
        className
      )}
      {...props}
    />
  );
}

export function FiatLink({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      className="flex-row items-center gap-3 rounded-[20px] bg-black/5 p-4"
      onPress={onPress}
    >
      <View className="h-10 w-10 items-center justify-center rounded-full bg-white">
        <Ionicons name={icon} size={20} color="black" />
      </View>
      <View className="flex-1">
        <Typography weight="600">{title}</Typography>
        {subtitle ? (
          <Typography className="mt-0.5 text-sm text-black/40">
            {subtitle}
          </Typography>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={17} color="#999" />
    </Pressable>
  );
}
