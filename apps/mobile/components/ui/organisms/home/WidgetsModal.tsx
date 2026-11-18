import React from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { ActionModal } from "@/components/ui/organisms/ActionModal";
import { cn } from "@/utils/cn";
import type { CountryCard } from "@/utils/countryCards";
import type { HomeWidgetKey, HomeWidgetVisibility } from "@/utils/homeWidgets";

interface WidgetsModalProps {
  visible: boolean;
  onClose: () => void;
  visibility: HomeWidgetVisibility;
  /** Null when the person's country is not known yet. */
  card: CountryCard | null;
  onChange: (key: HomeWidgetKey, visible: boolean) => void;
}

/** Share of the screen the grid may take before it scrolls. */
const GRID_MAX_SCREEN_SHARE = 0.58;

function CountryPreview({ card }: { card: CountryCard }) {
  return (
    <>
      <View className="h-16 w-full overflow-hidden rounded-2xl">
        <Image
          source={{ uri: card.photoUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: "rgba(0,0,0,0.22)" },
          ]}
        />
        <View className="flex-1 items-center justify-center">
          {card.flagUrl ? (
            <Image
              source={{ uri: card.flagUrl }}
              style={{ width: 28, height: 28, borderRadius: 14 }}
            />
          ) : (
            <Ionicons name="globe-outline" size={28} color="#FFF" />
          )}
        </View>
      </View>
      <View className="items-center">
        <Typography
          weight="600"
          className="text-center text-[15px] leading-5"
          numberOfLines={2}
        >
          {card.name}
        </Typography>
        <Typography
          weight="500"
          className="mt-0.5 text-center text-xs text-black/40"
          numberOfLines={1}
        >
          {`${card.currency ?? "USD"} balance`}
        </Typography>
      </View>
    </>
  );
}

function PreviewCard({
  title,
  on,
  onToggle,
  children,
}: {
  title: string;
  on: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <HapticPressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={title}
      onPress={onToggle}
      className="aspect-square w-[48.5%] rounded-[28px] bg-black/[0.05]"
    >
      <View
        className={cn(
          "absolute right-3 top-3 z-10 size-7 items-center justify-center rounded-full",
          on ? "bg-black" : "bg-black/10"
        )}
      >
        <Ionicons
          name={on ? "checkmark" : "add"}
          size={16}
          color={on ? "#FFF" : "#000"}
        />
      </View>
      <View
        className={cn(
          "flex-1 items-center justify-between px-3 pb-4 pt-5",
          !on && "opacity-50"
        )}
      >
        {children}
      </View>
    </HapticPressable>
  );
}

export function WidgetsModal({
  visible,
  onClose,
  visibility,
  card,
  onChange,
}: WidgetsModalProps) {
  const { height } = useWindowDimensions();

  return (
    <ActionModal visible={visible} onClose={onClose}>
      <View className="mb-5 flex-col items-center justify-center">
        <View className="mb-5">
          <Ionicons name="grid-outline" size={30} color="#000" />
        </View>
        <Typography weight="600" className="mb-1 text-base">
          Home widgets
        </Typography>
        <Typography
          weight="500"
          className="max-w-[240px] text-center text-sm text-black/40"
        >
          Tap to add or remove a widget
        </Typography>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        // DYNAMIC-SIZE: the share of the screen the grid may take
        style={{ maxHeight: height * GRID_MAX_SCREEN_SHARE }}
      >
        <View className="flex-row flex-wrap justify-between gap-y-3">
          {card ? (
            <PreviewCard
              title={card.name}
              on={visibility.country}
              onToggle={() => onChange("country", !visibility.country)}
            >
              <CountryPreview card={card} />
            </PreviewCard>
          ) : null}
        </View>
      </ScrollView>
    </ActionModal>
  );
}
