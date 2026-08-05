import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { ScreenLayout } from "@/components/ui/layout";
import { useBalances } from "@/hooks/useBalances";
import { useToast } from "@/contexts/ToastContext";
import { getUsdcMint } from "@/utils/cluster";
import { cn } from "@/utils/cn";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

interface SwapToken {
  symbol: string;
  mint: string;
  decimals: number;
}

const SOL: SwapToken = {
  symbol: "SOL",
  mint: "So11111111111111111111111111111111111111112",
  decimals: 9,
};

/**
 * Swap between the Consumer's assets.
 *
 * The keypad drives the "you pay" amount; the receive side stays blank until a
 * quote is wired, because showing a converted figure without a real rate would
 * be inventing a price the Consumer might act on.
 */
export default function SwapScreen() {
  const router = useRouter();
  const { showToast } = useToast();
  const { tokens } = useBalances();

  const usdc: SwapToken = useMemo(
    () => ({ symbol: "USDC", mint: getUsdcMint(), decimals: 6 }),
    []
  );

  const [payToken, setPayToken] = useState<SwapToken>(SOL);
  const [receiveToken, setReceiveToken] = useState<SwapToken>(usdc);
  const [amount, setAmount] = useState("0");

  const payBalance = useMemo(() => {
    const held = tokens.find((t) => t.mint === payToken.mint);
    if (!held) return 0;
    return Number(held.amountRaw) / 10 ** held.decimals;
  }, [tokens, payToken]);

  const canReview = Number(amount) > 0 && Number(amount) <= payBalance;

  const press = (key: string) => {
    if (key === "⌫") {
      setAmount((a) => (a.length <= 1 ? "0" : a.slice(0, -1)));
      return;
    }
    if (key === "." && amount.includes(".")) return;
    setAmount((a) => (a === "0" && key !== "." ? key : a + key));
  };

  const flip = () => {
    setPayToken(receiveToken);
    setReceiveToken(payToken);
    setAmount("0");
  };

  return (
    <ScreenLayout>
      <View className="flex-row items-center justify-center py-2">
        <Typography variant="title1" weight="600">
          Swap
        </Typography>
      </View>

      <View className="flex-1 justify-end">
        <Typography variant="body" weight="600" className="mb-2">
          You pay
        </Typography>
        <View className="flex-row items-center justify-between">
          <Typography
            weight="500"
            className={cn(
              "text-[44px] tracking-[-1.2px]",
              amount === "0" ? "text-black/25" : "text-black"
            )}
          >
            {amount}
          </Typography>
          <TokenPill token={payToken} />
        </View>
        <View className="mt-1 flex-row items-center justify-end gap-1">
          <Typography variant="body" weight="600">
            MAX
          </Typography>
          <Typography variant="body" className="text-black/30">
            {payBalance.toLocaleString("en-US", { maximumFractionDigits: 4 })}
          </Typography>
        </View>

        <View className="my-5 flex-row items-center gap-3">
          <View className="h-px flex-1 bg-black/10" />
          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel="Swap direction"
            feedback="selection"
            onPress={flip}
          >
            <Ionicons name="swap-vertical" size={22} color="#000" />
          </HapticPressable>
          <View className="h-px flex-1 bg-black/10" />
        </View>

        <Typography variant="body" weight="600" className="mb-2">
          You receive
        </Typography>
        <View className="flex-row items-center justify-between">
          <Typography
            weight="500"
            className="text-[44px] tracking-[-1.2px] text-black/25"
          >
            0
          </Typography>
          <TokenPill token={receiveToken} />
        </View>
      </View>

      <View className="mt-6 flex-row flex-wrap">
        {KEYS.map((key) => (
          <HapticPressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={key === "⌫" ? "Delete" : key}
            onPress={() => press(key)}
            // A keypad is picking, not committing; impact on every digit is noise.
            feedback="selection"
            scaleOnPress={false}
            className="w-1/3 items-center py-4"
          >
            <Typography weight="500" className="text-[26px]">
              {key}
            </Typography>
          </HapticPressable>
        ))}
      </View>

      <HapticPressable
        accessibilityRole="button"
        accessibilityLabel="Review swap"
        disabled={!canReview}
        onPress={() => showToast("Swap quotes open soon")}
        className={cn(
          "mb-2 mt-4 items-center rounded-full py-5",
          canReview ? "bg-black" : "bg-black/40"
        )}
      >
        <Typography variant="title2" weight="600" className="text-white">
          Review
        </Typography>
      </HapticPressable>

      <View className="absolute left-5 top-2">
        <HapticPressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={22} color="#000" />
        </HapticPressable>
      </View>
    </ScreenLayout>
  );
}

function TokenPill({ token }: { token: SwapToken }) {
  return (
    <View className="flex-row items-center gap-2 rounded-full bg-black/[0.04] py-2 pl-2 pr-3">
      <View className="h-7 w-7 items-center justify-center rounded-full bg-black">
        <Typography variant="caption" weight="700" className="text-white">
          {token.symbol.slice(0, 1)}
        </Typography>
      </View>
      <Typography variant="title2" weight="600">
        {token.symbol}
      </Typography>
      <Ionicons name="chevron-forward" size={16} color="rgba(0,0,0,0.3)" />
    </View>
  );
}
