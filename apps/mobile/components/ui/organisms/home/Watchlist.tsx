import React from "react";
import { View } from "react-native";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { TokenMark } from "@/components/ui/atoms/TokenMark";
import { Typography } from "@/components/ui/atoms/Typography";
import type { WatchedToken } from "@/hooks/useWatchlist";
import { cn } from "@/utils/cn";
import { GLASS } from "@/components/ui/glass";
import { HomeSection } from "./HomeSection";

function formatPrice(price: number): string {
  if (price >= 1) {
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  const decimals = Math.min(10, Math.max(2, 2 - Math.floor(Math.log10(price))));
  // Keep two decimals and trim zeros past them: "$0.0000026", not "$0.00000260".
  return price.toFixed(decimals).replace(/(\.\d\d\d*?)0+$/, "$1");
}

function changeClass(change: number): string {
  return change > 0 ? GLASS.up : change < 0 ? GLASS.down : GLASS.small;
}

function Row({
  token,
  onPress,
}: {
  token: WatchedToken;
  onPress?: () => void;
}) {
  const priced = token.usdPrice !== null;
  const spoken = priced
    ? `${token.name}, $${formatPrice(token.usdPrice!)}`
    : `${token.name}, price unavailable`;
  return (
    <HapticPressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={spoken}
      disabled={!onPress}
      onPress={onPress}
      className="flex-row items-center gap-3 py-3"
    >
      <TokenMark
        mint={token.mint}
        label={token.name}
        iconUrl={token.iconUrl}
        size={40}
      />
      <View className="flex-1">
        <Typography
          weight="600"
          className={cn("text-base", GLASS.ink)}
          numberOfLines={1}
        >
          {token.name}
        </Typography>
        <Typography weight="500" className={cn("text-[13px]", GLASS.small)}>
          {token.symbol}
        </Typography>
      </View>
      <View className="items-end">
        <Typography
          weight="600"
          className={cn("text-base", priced ? GLASS.ink : GLASS.small)}
        >
          {priced ? `$${formatPrice(token.usdPrice!)}` : "Unavailable"}
        </Typography>
        {token.change24h !== null && (
          <Typography
            weight="600"
            className={cn("text-[12px]", changeClass(token.change24h))}
          >
            {token.change24h > 0 ? "+" : ""}
            {token.change24h.toFixed(2)}%
          </Typography>
        )}
      </View>
    </HapticPressable>
  );
}

export function Watchlist({
  tokens,
  onOpen,
}: {
  tokens: WatchedToken[];
  onOpen?: () => void;
}) {
  return (
    <HomeSection title="Watchlist">
      <View className={cn("px-4 py-1", GLASS.card)}>
        {tokens.map((token, index) => (
          <View
            key={token.mint}
            className={cn(index > 0 && "border-t", GLASS.divider)}
          >
            <Row token={token} onPress={onOpen} />
          </View>
        ))}
      </View>
    </HomeSection>
  );
}
