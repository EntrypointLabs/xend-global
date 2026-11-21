import React from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { GlassButton } from "@/components/ui/atoms/Glass";
import { Typography } from "@/components/ui/atoms/Typography";
import { cn } from "@/utils/cn";

/**
 * The bank-send steps live in the send sheet but speak the same visual
 * language as the full-screen naira pages (Add naira, Verify identity): white
 * canvas, round glass back button, large left-set headings, pinned footer.
 */
export const BANK_SHEET_BG = "#FFFFFF";
export const DISPLAY = { fontFamily: "Montserrat_900Black" } as const;

export function BankSheetTop({
  leave,
  onPress,
  disabled = false,
}: {
  leave: "back" | "close";
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <View className="px-5 pb-4 pt-1">
      <GlassButton
        radius={999}
        accessibilityRole="button"
        accessibilityLabel={leave === "close" ? "Close" : "Back"}
        onPress={onPress}
        disabled={disabled}
        className="size-11 items-center justify-center rounded-full"
        fallbackClassName="border border-black/[0.08] bg-white"
      >
        <Ionicons
          name={leave === "close" ? "close" : "arrow-back"}
          size={22}
          color="#0A0A0A"
        />
      </GlassButton>
    </View>
  );
}

export function BankHeading({
  title,
  subtitle,
  className,
}: {
  title: string;
  subtitle?: string;
  className?: string;
}) {
  return (
    <View className={cn("px-5", className)}>
      <Typography
        accessibilityRole="header"
        weight="700"
        className="text-[28px] leading-[34px] tracking-[-0.6px] text-[#0E0F0C]"
      >
        {title}
      </Typography>
      {subtitle ? (
        <Typography
          weight="500"
          className="mt-2 text-[14px] leading-[20px] text-black/55"
        >
          {subtitle}
        </Typography>
      ) : null}
    </View>
  );
}

/** Pinned above the home indicator, the same height as FeatureScreen's. */
export function BankSheetFooter({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View className="px-5 pt-4" style={{ paddingBottom: insets.bottom + 12 }}>
      {children}
    </View>
  );
}

export function SheetRow({
  label,
  value,
  strong = false,
  tone = "default",
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "default" | "error";
}) {
  return (
    <View className="flex-row items-center justify-between">
      <Typography weight="500" className="text-[15px] text-black/60">
        {label}
      </Typography>
      <Typography
        weight={strong ? "700" : "600"}
        className={cn(
          "ml-6 shrink text-right text-[15px] tabular-nums",
          tone === "error" ? "text-destructive" : "text-[#0E0F0C]"
        )}
      >
        {value}
      </Typography>
    </View>
  );
}
