import React from "react";
import { View } from "react-native";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { TokenMark } from "@/components/ui/atoms/TokenMark";
import { Typography } from "@/components/ui/atoms/Typography";
import type { WatchedToken } from "@/hooks/useWatchlist";
import { cn } from "@/utils/cn";
import { useSurface, type Surface } from "@/components/ui/glass";
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

function changeClass(change: number, S: Surface): string {
  return change > 0 ? S.up : change < 0 ? S.down : S.small;
}

function Row({
  token,
  onPress,
}: {
  token: WatchedToken;
  onPress?: () => void;
}) {
  const S = useSurface();
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
          className={cn("text-base", S.ink)}
          numberOfLines={1}
        >
          {token.name}
        </Typography>
        <Typography weight="500" className={cn("text-[13px]", S.small)}>
          {token.symbol}
        </Typography>
      </View>
      <View className="items-end">
        <Typography
          weight="600"
          className={cn("text-base", priced ? S.ink : S.small)}
        >
          {priced ? `$${formatPrice(token.usdPrice!)}` : "Unavailable"}
        </Typography>
        {token.change24h !== null && (
          <Typography
            weight="600"
            className={cn("text-[12px]", changeClass(token.change24h, S))}
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
  const S = useSurface();
  return (
    <HomeSection title="Watchlist">
      <View
        className={cn("px-4 py-1", S.card)}
        // PLATFORM-SHADOW
        style={S.raised}
      >
        {tokens.map((token, index) => (
          <View
            key={token.mint}
            className={cn(index > 0 && "border-t", S.divider)}
          >
            <Row token={token} onPress={onOpen} />
          </View>
        ))}
      </View>
    </HomeSection>
  );
}
