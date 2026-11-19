import React, { useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path, Rect } from "react-native-svg";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { GlassButton } from "@/components/ui/atoms/Glass";
import { Typography } from "@/components/ui/atoms/Typography";
import { useFeature } from "@/hooks/useFeature";
import { cn } from "@/utils/cn";
import {
  DO_MORE_ITEMS,
  DO_MORE_SECTIONS,
  type DoMoreItem,
  type DoMoreSection,
} from "@/utils/doMore";

/**
 * Everything Prydd does beyond the basics, grouped. The chips jump to a group;
 * a row opens the feature, or its intro page while it is not built yet.
 */
export default function DoMoreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const swapEnabled = useFeature("swap");
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Partial<Record<DoMoreSection, number>>>({});
  const [current, setCurrent] = useState<DoMoreSection>("Accounts");

  const items = DO_MORE_ITEMS.filter(
    (item) => item.flag !== "swap" || swapEnabled
  );
  const sections = DO_MORE_SECTIONS.filter((section) =>
    items.some((item) => item.section === section)
  );

  const open = (item: DoMoreItem) => {
    if (item.route) router.push(item.route);
    else router.push(`/do-more/${item.key}`);
  };

  const jump = (section: DoMoreSection) => {
    setCurrent(section);
    scrollRef.current?.scrollTo({
      y: offsets.current[section] ?? 0,
      animated: true,
    });
  };

  const goBack = () =>
    router.canGoBack() ? router.back() : router.replace("/(tabs)");

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-5">
        <GlassButton
          radius={999}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={goBack}
          className="size-11 items-center justify-center rounded-full"
          fallbackClassName="border border-black/[0.08] bg-white"
        >
          <Ionicons name="close" size={22} color="#0A0A0A" />
        </GlassButton>
        <Typography
          accessibilityRole="header"
          weight="700"
          className="mt-7 text-[34px] leading-[40px] tracking-[-0.8px] text-[#0E0F0C]"
        >
          Do more with Prydd
        </Typography>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mt-5 grow-0"
        contentContainerClassName="gap-2 px-5"
      >
        {sections.map((section) => (
          <HapticPressable
            key={section}
            accessibilityRole="tab"
            accessibilityState={{ selected: section === current }}
            onPress={() => jump(section)}
            className={cn(
              "rounded-full px-4 py-2.5",
              section === current ? "bg-black/[0.06]" : "bg-transparent"
            )}
          >
            <Typography
              weight="600"
              className={cn(
                "text-[15px]",
                section === current ? "text-[#0E0F0C]" : "text-black/45"
              )}
            >
              {section}
            </Typography>
          </HapticPressable>
        ))}
      </ScrollView>

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {sections.map((section) => (
          <View
            key={section}
            className="px-5 pt-6"
            onLayout={(event) => {
              offsets.current[section] = event.nativeEvent.layout.y;
            }}
          >
            <Typography weight="500" className="text-[16px] text-black/55">
              {section}
            </Typography>
            <View className="mt-3">
              {items
                .filter((item) => item.section === section)
                .map((item) => (
                  <Row key={item.key} item={item} onPress={() => open(item)} />
                ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function Row({ item, onPress }: { item: DoMoreItem; onPress: () => void }) {
  return (
    <HapticPressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${item.description}`}
      onPress={onPress}
      className="flex-row items-center gap-3.5 py-3"
    >
      <View
        className="size-12 items-center justify-center rounded-full"
        // DYNAMIC-COLOR (per-feature tile)
        style={{ backgroundColor: item.tile }}
      >
        {item.icon === "jar" ? (
          <JarGlyph color={item.glyph} />
        ) : (
          <Ionicons name={item.icon} size={21} color={item.glyph} />
        )}
      </View>
      <View className="flex-1">
        <Typography
          weight="600"
          className="text-[15px] leading-[20px] text-[#0E0F0C]"
        >
          {item.title}
        </Typography>
        <Typography
          weight="500"
          className="mt-0.5 text-[13px] leading-[18px] text-black/50"
        >
          {item.description}
        </Typography>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#00000059" />
    </HapticPressable>
  );
}

function JarGlyph({ color }: { color: string }) {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
      <Rect
        x={7}
        y={3}
        width={10}
        height={3.5}
        rx={1}
        stroke={color}
        strokeWidth={1.8}
      />
      <Path
        d="M8 6.5c-1.6 1.2-2.5 2.6-2.5 4.5v7.5A2.5 2.5 0 0 0 8 21h8a2.5 2.5 0 0 0 2.5-2.5V11c0-1.9-.9-3.3-2.5-4.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}
