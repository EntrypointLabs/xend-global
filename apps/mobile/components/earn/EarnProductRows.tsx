import React from "react";
import { Image, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import BalanceView from "@/components/BalanceView";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { usePalette } from "@/hooks/usePalette";
import type { EarnProduct } from "@/hooks/useEarn";
import { TokenStack } from "@/components/earn/EarnAssets";

export function apyLabel(product: EarnProduct) {
  if (product.apy === null) return "Rate unavailable";
  return `${product.apyDisplay} APY`;
}

function ProductHeading({ product }: { product: EarnProduct }) {
  return (
    <View className="min-w-0 flex-1">
      <Typography
        variant="body"
        numberOfLines={1}
        className="text-foreground/40"
      >
        {product.provider}
        <Typography variant="body" className="text-foreground/20">
          {"  •  "}
        </Typography>
        <Typography variant="body" weight="600" className="text-success">
          {apyLabel(product)}
        </Typography>
      </Typography>
      <Typography variant="title2" weight="600" numberOfLines={1}>
        {product.name}
      </Typography>
    </View>
  );
}

function Logo({ product }: { product: EarnProduct }) {
  return product.icon ? (
    <Image source={product.icon} className="h-11 w-11 rounded-2xl" />
  ) : (
    <View className="h-11 w-11 rounded-2xl bg-foreground/5" />
  );
}

/** A product the Consumer holds: what it is worth now, and the way in. */
export function PositionRow({
  product,
  onPress,
}: {
  product: EarnProduct;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <HapticPressable
      accessibilityRole="button"
      accessibilityLabel={`${product.provider} position, ${(product.position ?? 0).toFixed(2)} dollars`}
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-2xl bg-foreground/[0.03] px-4 py-4"
    >
      <Logo product={product} />
      <ProductHeading product={product} />
      <BalanceView
        variant="title2"
        weight="600"
        amount={(product.position ?? 0).toFixed(2)}
      />
      <Ionicons name="chevron-forward" size={16} color={palette.fg(0.3)} />
    </HapticPressable>
  );
}

/** A product the Consumer has not put money into yet. */
export function ProductCard({
  product,
  onPress,
}: {
  product: EarnProduct;
  onPress: () => void;
}) {
  return (
    <HapticPressable
      accessibilityRole="button"
      accessibilityLabel={`About ${product.provider}`}
      onPress={onPress}
      className="rounded-2xl bg-foreground/[0.03] px-4 py-4"
    >
      <View className="flex-row items-center gap-3">
        <Logo product={product} />
        <ProductHeading product={product} />
        <TokenStack assets={product.assets} />
      </View>
      <Typography variant="body" className="mt-3 text-foreground/40">
        {product.description}
      </Typography>
    </HapticPressable>
  );
}
