import React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { TokenMark } from "@/components/ui/atoms/TokenMark";
import { Typography } from "@/components/ui/atoms/Typography";
import type { EarnAsset } from "@/hooks/useEarn";
import { usePalette } from "@/hooks/usePalette";
import { cn } from "@/utils/cn";
import { formatTokenAmount } from "@/utils/tokens";

type Mark = Pick<EarnAsset, "mint" | "symbol" | "iconUrl">;

/** Up to three token logos overlapping, then "+N" for the rest. */
export function TokenStack({
  assets,
  size = 22,
  max = 3,
}: {
  assets: Mark[];
  size?: number;
  max?: number;
}) {
  if (assets.length === 0) return null;
  const shown = assets.slice(0, max);
  const rest = assets.length - shown.length;
  return (
    <View
      accessible
      accessibilityLabel={assets.map((a) => a.symbol).join(", ")}
      className="flex-row items-center"
    >
      {shown.map((asset, i) => (
        <View
          key={asset.mint}
          className={cn("rounded-full border-2 border-card", i > 0 && "-ml-2")}
        >
          <TokenMark
            mint={asset.mint}
            label={asset.symbol}
            iconUrl={asset.iconUrl}
            size={size}
          />
        </View>
      ))}
      {rest > 0 && (
        // Solid underneath the tint, so the logo it overlaps does not show
        // through it.
        <View className="-ml-2 rounded-full border-2 border-card bg-card">
          <View className="h-[22px] min-w-[22px] items-center justify-center rounded-full bg-foreground/[0.06] px-1.5">
            <Typography variant="caption" weight="600">
              +{rest}
            </Typography>
          </View>
        </View>
      )}
    </View>
  );
}

/** The token an amount is in, tappable when there is more than one to pick. */
export function AssetChip({
  asset,
  onPress,
}: {
  asset: Mark;
  onPress?: () => void;
}) {
  const palette = usePalette();
  return (
    <HapticPressable
      accessibilityRole="button"
      accessibilityLabel={
        onPress ? `Change token, ${asset.symbol}` : asset.symbol
      }
      disabled={!onPress}
      onPress={onPress}
      className="flex-row items-center gap-2 rounded-full bg-foreground/5 py-1.5 pl-1.5 pr-3"
    >
      <TokenMark
        mint={asset.mint}
        label={asset.symbol}
        iconUrl={asset.iconUrl}
        size={24}
      />
      <Typography variant="body" weight="600">
        {asset.symbol}
      </Typography>
      {onPress && (
        <Ionicons name="chevron-down" size={14} color={palette.fg(0.5)} />
      )}
    </HapticPressable>
  );
}

export interface PickableAsset extends Mark {
  name: string;
  decimals: number;
  /** Units the Consumer can move: held for a deposit, lent for a withdrawal. */
  amount: number;
  usd: number | null;
}

/** A sheet over the deposit or withdraw screen for choosing the token. */
export function AssetPickerSheet({
  title,
  assets,
  selected,
  onPick,
  onClose,
}: {
  title: string;
  assets: PickableAsset[];
  selected: string;
  onPick: (mint: string) => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  return (
    <View className="absolute inset-0 justify-end">
      <Pressable
        accessibilityLabel="Close token list"
        onPress={onClose}
        className="absolute inset-0 bg-black/20"
      />
      <View
        accessibilityViewIsModal
        className="mx-3 mb-7 max-h-[70%] rounded-[32px] bg-card px-5 pb-4 pt-6"
      >
        <Typography variant="title1" weight="600" className="mb-3 text-center">
          {title}
        </Typography>
        <ScrollView showsVerticalScrollIndicator={false}>
          {assets.map((asset) => {
            const active = asset.mint === selected;
            return (
              <HapticPressable
                key={asset.mint}
                accessibilityRole="button"
                // Listed so the Consumer sees what can be lent, but there is
                // nothing of it to move.
                disabled={asset.amount <= 0}
                accessibilityState={{
                  selected: active,
                  disabled: asset.amount <= 0,
                }}
                accessibilityLabel={`${asset.name}, ${formatTokenAmount(asset.amount, asset.decimals)} ${asset.symbol}`}
                onPress={() => onPick(asset.mint)}
                className={cn(
                  "flex-row items-center gap-3 py-3",
                  asset.amount <= 0 && "opacity-40"
                )}
              >
                <TokenMark
                  mint={asset.mint}
                  label={asset.symbol}
                  iconUrl={asset.iconUrl}
                  size={40}
                />
                <View className="flex-1">
                  <Typography variant="title2" weight="600">
                    {asset.name}
                  </Typography>
                  <Typography variant="body" className="text-foreground/40">
                    {formatTokenAmount(asset.amount, asset.decimals)}{" "}
                    {asset.symbol}
                  </Typography>
                </View>
                {asset.usd !== null && (
                  <Typography variant="body" weight="600">
                    {asset.usd.toLocaleString("en-US", {
                      style: "currency",
                      currency: "USD",
                    })}
                  </Typography>
                )}
                {active && (
                  <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color={palette.foreground}
                  />
                )}
              </HapticPressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}
