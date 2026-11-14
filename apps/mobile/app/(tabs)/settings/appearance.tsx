import React, { useState } from "react";
import { Image, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { ActionModal } from "@/components/ui/organisms/ActionModal";
import {
  THEME_LABELS,
  useAppearance,
  type AppIconChoice,
} from "@/contexts/AppearanceContext";
import { useToast } from "@/contexts/ToastContext";
import { cn } from "@/utils/cn";

const ICONS: {
  value: AppIconChoice;
  label: string;
  preview: number;
}[] = [
  {
    value: "black",
    label: "Black",
    preview: require("@/assets/images/icon.png"),
  },
  {
    value: "white",
    label: "White",
    preview: require("@/assets/images/app-icons/icon-white.png"),
  },
];

export default function AppearanceScreen() {
  const { theme, icon, setIcon } = useAppearance();
  const { showToast } = useToast();
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  const iconLabel = ICONS.find((i) => i.value === icon)!.label;

  const chooseIcon = async (value: AppIconChoice) => {
    setIconPickerOpen(false);
    if (value === icon) return;
    try {
      await setIcon(value);
    } catch {
      showToast("Couldn't change the app icon. Try again.");
    }
  };

  return (
    <ScreenLayout>
      <HapticPressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => router.back()}
        className="mt-2 size-11 items-center justify-center rounded-full bg-black/5"
      >
        <Ionicons name="arrow-back" size={20} color="#000" />
      </HapticPressable>

      <Typography weight="700" className="mt-5 text-3xl text-black">
        Appearance
      </Typography>

      <View className="mt-5 rounded-3xl bg-black/[0.04] px-4 py-2">
        <Row
          icon={
            <Image
              source={require("@/assets/images/logo/prydd-mark-black-2048.png")}
              className="size-5"
              resizeMode="contain"
            />
          }
          label="App icon"
          value={iconLabel}
          onPress={() => setIconPickerOpen(true)}
        />
        <Row
          icon={<Ionicons name="bulb-outline" size={22} color="#000" />}
          label="Theme"
          value={THEME_LABELS[theme]}
          onPress={() => router.push("/settings/theme-preview" as never)}
        />
      </View>

      <ActionModal
        visible={iconPickerOpen}
        onClose={() => setIconPickerOpen(false)}
      >
        <Typography weight="700" className="mb-4 mt-1 text-xl text-black">
          Change your icon
        </Typography>
        <View className="-mx-3 gap-1">
          {ICONS.map((choice) => {
            const on = choice.value === icon;
            return (
              <HapticPressable
                key={choice.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={choice.label}
                onPress={() => chooseIcon(choice.value)}
                className={cn(
                  "flex-row items-center gap-4 rounded-2xl px-3 py-3",
                  on && "bg-black/[0.05]"
                )}
              >
                <View>
                  <Image
                    source={choice.preview}
                    className="size-12 rounded-full border border-black/10"
                    resizeMode="cover"
                  />
                  {on && (
                    <View className="absolute -bottom-0.5 -right-0.5 size-5 items-center justify-center rounded-full border-2 border-white bg-black">
                      <Ionicons name="checkmark" size={11} color="#FFF" />
                    </View>
                  )}
                </View>
                <Typography weight="500" className="text-base text-black">
                  {choice.label}
                </Typography>
              </HapticPressable>
            );
          })}
        </View>
      </ActionModal>
    </ScreenLayout>
  );
}

function Row({
  icon,
  label,
  value,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <HapticPressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      onPress={onPress}
      className="flex-row items-center gap-4 py-3"
    >
      <View className="size-6 items-center justify-center">{icon}</View>
      <View className="flex-1">
        <Typography weight="500" className="text-base text-black">
          {label}
        </Typography>
        <Typography weight="500" className="text-[13px] text-black/40">
          {value}
        </Typography>
      </View>
    </HapticPressable>
  );
}
