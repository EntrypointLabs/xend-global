import React, { useState } from "react";
import { Image, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { ActionModal } from "@/components/ui/organisms/ActionModal";
import {
  MODE_LABELS,
  THEME_LABELS,
  useAppearance,
  type AppIconChoice,
  type AppMode,
} from "@/contexts/AppearanceContext";
import { useToast } from "@/contexts/ToastContext";
import { usePalette } from "@/hooks/usePalette";
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

const MODES: { value: AppMode; glyph: keyof typeof Ionicons.glyphMap }[] = [
  { value: "system", glyph: "phone-portrait-outline" },
  { value: "light", glyph: "sunny-outline" },
  { value: "dark", glyph: "moon-outline" },
];

export default function AppearanceScreen() {
  const { theme, icon, mode, setIcon, setMode } = useAppearance();
  const { showToast } = useToast();
  const palette = usePalette();
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [modePickerOpen, setModePickerOpen] = useState(false);

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
        className="mt-2 size-11 items-center justify-center rounded-full bg-foreground/5"
      >
        <Ionicons name="arrow-back" size={20} color={palette.foreground} />
      </HapticPressable>

      <Typography weight="700" className="mt-5 text-3xl text-foreground">
        Appearance
      </Typography>

      <View className="mt-5 rounded-3xl bg-foreground/[0.04] px-4 py-2">
        <Row
          icon={
            <Image
              source={require("@/assets/images/logo/prydd-mark-black-2048.png")}
              className="size-5"
              resizeMode="contain"
              tintColor={palette.foreground}
            />
          }
          label="App icon"
          value={iconLabel}
          onPress={() => setIconPickerOpen(true)}
        />
        <Row
          icon={
            <Ionicons
              name="contrast-outline"
              size={22}
              color={palette.foreground}
            />
          }
          label="Mode"
          value={MODE_LABELS[mode]}
          onPress={() => setModePickerOpen(true)}
        />
        <Row
          icon={
            <Ionicons
              name="bulb-outline"
              size={22}
              color={palette.foreground}
            />
          }
          label="Theme"
          value={THEME_LABELS[theme]}
          onPress={() => router.push("/settings/theme-preview" as never)}
        />
      </View>

      <ActionModal
        visible={iconPickerOpen}
        onClose={() => setIconPickerOpen(false)}
      >
        <Typography weight="700" className="mb-4 mt-1 text-xl text-foreground">
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
                  on && "bg-foreground/[0.05]"
                )}
              >
                <View>
                  <Image
                    source={choice.preview}
                    className="size-12 rounded-full border border-foreground/10"
                    resizeMode="cover"
                  />
                  {on && (
                    <View className="absolute -bottom-0.5 -right-0.5 size-5 items-center justify-center rounded-full border-2 border-card bg-primary">
                      <Ionicons
                        name="checkmark"
                        size={11}
                        color={palette.primaryForeground}
                      />
                    </View>
                  )}
                </View>
                <Typography weight="500" className="text-base text-foreground">
                  {choice.label}
                </Typography>
              </HapticPressable>
            );
          })}
        </View>
      </ActionModal>

      <ActionModal
        visible={modePickerOpen}
        onClose={() => setModePickerOpen(false)}
      >
        <Typography weight="700" className="mb-4 mt-1 text-xl text-foreground">
          Choose a mode
        </Typography>
        <View className="-mx-3 gap-1">
          {MODES.map((choice) => {
            const on = choice.value === mode;
            return (
              <HapticPressable
                key={choice.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={MODE_LABELS[choice.value]}
                onPress={() => {
                  setModePickerOpen(false);
                  setMode(choice.value);
                }}
                className={cn(
                  "flex-row items-center gap-4 rounded-2xl px-3 py-3",
                  on && "bg-foreground/[0.05]"
                )}
              >
                <View className="size-12 items-center justify-center rounded-full bg-foreground/5">
                  <Ionicons
                    name={choice.glyph}
                    size={22}
                    color={palette.foreground}
                  />
                </View>
                <Typography
                  weight="500"
                  className="flex-1 text-base text-foreground"
                >
                  {MODE_LABELS[choice.value]}
                </Typography>
                {on && (
                  <Ionicons
                    name="checkmark"
                    size={20}
                    color={palette.foreground}
                  />
                )}
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
        <Typography weight="500" className="text-base text-foreground">
          {label}
        </Typography>
        <Typography weight="500" className="text-[13px] text-foreground/40">
          {value}
        </Typography>
      </View>
    </HapticPressable>
  );
}
