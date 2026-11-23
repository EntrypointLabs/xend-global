import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { GlassButton } from "@/components/ui/atoms/Glass";
import { TokenMark } from "@/components/ui/atoms/TokenMark";
import { Typography } from "@/components/ui/atoms/Typography";
import { ScreenLayout } from "@/components/ui/layout";
import { useFeature } from "@/hooks/useFeature";
import { usePalette } from "@/hooks/usePalette";
import { useBalances } from "@/hooks/useBalances";
import { TurnOnSwap } from "@/components/swap/TurnOnSwap";
import { useSwapAccess } from "@/hooks/useSwapAccess";
import { useSwapQuote } from "@/hooks/useSwapQuote";
import { useExecuteSwap } from "@/hooks/useExecuteSwap";
import { useToast } from "@/contexts/ToastContext";
import { formatRawAmount, type SwapToken } from "@/utils/swap";
import { flipSwapPair, useSwapPair, type SwapSide } from "@/utils/swapPair";
import { cn } from "@/utils/cn";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

/** The route survives the flag, so a deep link can still land here. */
export default function SwapRoute() {
  const enabled = useFeature("swap");
  const access = useSwapAccess();
  if (!enabled) return <Redirect href="/" />;
  // Held blank rather than guessed: showing the keypad to an Account that
  // cannot swap yet, then replacing it, reads as the app changing its mind.
  if (access.isPending) return <ScreenLayout>{null}</ScreenLayout>;
  // An answer that could not be read is not a refusal. The swap itself still
  // says so if the Account turns out not to be ready.
  if (access.data && access.data.state !== "ready") {
    return <TurnOnSwap access={access.data} />;
  }
  return <SwapScreen />;
}

/**
 * Swap between the Consumer's assets.
 *
 * The keypad drives the "you pay" amount; the receive side stays blank until a
 * live price arrives, because showing a converted figure without a real rate
 * would be inventing a price the Consumer might act on.
 */
function SwapScreen() {
  const router = useRouter();
  const palette = usePalette();
  const { showToast } = useToast();
  const { tokens } = useBalances();

  const { pay: payToken, receive: receiveToken } = useSwapPair();
  const [amount, setAmount] = useState("0");

  // An amount belongs to the asset it was typed for: 5 SOL is not 5 USDC.
  useEffect(() => setAmount("0"), [payToken.mint]);

  const payBalance = useMemo(() => {
    const held = tokens.find((t) => t.mint === payToken.mint);
    if (!held) return 0;
    return Number(held.amountRaw) / 10 ** held.decimals;
  }, [tokens, payToken]);

  const withinBalance = Number(amount) > 0 && Number(amount) <= payBalance;

  const amountRaw = useMemo(() => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return "0";
    return BigInt(Math.round(parsed * 10 ** payToken.decimals)).toString();
  }, [amount, payToken.decimals]);

  const { quote, isLoading, error } = useSwapQuote({
    inputMint: payToken.mint,
    outputMint: receiveToken.mint,
    amountRaw,
    enabled: withinBalance,
  });

  const { execute, isExecuting } = useExecuteSwap();

  const confirm = async () => {
    if (!quote) return;
    const outcome = await execute(quote);
    if (outcome.status === "canceled") return;
    if (outcome.status === "failed") {
      showToast(outcome.message);
      return;
    }
    // Home, where the balance is. The toast follows the swap from here.
    router.replace("/(tabs)");
  };

  const receiveDisplay = quote
    ? formatRawAmount(quote.outAmountRaw, receiveToken.decimals)
    : "0";
  const canReview = withinBalance && !!quote;

  const press = (key: string) => {
    if (key === "⌫") {
      setAmount((a) => (a.length <= 1 ? "0" : a.slice(0, -1)));
      return;
    }
    if (key === "." && amount.includes(".")) return;
    setAmount((a) => (a === "0" && key !== "." ? key : a + key));
  };

  const choose = (side: SwapSide) =>
    router.push({ pathname: "/swap/token", params: { side } });

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
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.5}
            className={cn(
              "mr-3 flex-1 text-[44px] tracking-[-1.2px]",
              amount === "0" ? "text-foreground/25" : "text-foreground"
            )}
          >
            {amount}
          </Typography>
          <TokenPill
            token={payToken}
            label="Choose what you pay with"
            onPress={() => choose("pay")}
          />
        </View>
        <View className="mt-1 flex-row items-center justify-end gap-1">
          <Typography variant="body" weight="600">
            MAX
          </Typography>
          <Typography variant="body" className="text-foreground/30">
            {payBalance.toLocaleString("en-US", { maximumFractionDigits: 4 })}
          </Typography>
        </View>

        <View className="my-5 flex-row items-center gap-3">
          <View className="h-px flex-1 bg-foreground/10" />
          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel="Swap direction"
            feedback="selection"
            onPress={flipSwapPair}
          >
            <Ionicons
              name="swap-vertical"
              size={22}
              color={palette.foreground}
            />
          </HapticPressable>
          <View className="h-px flex-1 bg-foreground/10" />
        </View>

        <Typography variant="body" weight="600" className="mb-2">
          You receive
        </Typography>
        <View className="flex-row items-center justify-between">
          <Typography
            weight="500"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.5}
            className={cn(
              "mr-3 flex-1 text-[44px] tracking-[-1.2px]",
              quote ? "text-foreground" : "text-foreground/25"
            )}
          >
            {receiveDisplay}
          </Typography>
          <TokenPill
            token={receiveToken}
            label="Choose what you receive"
            onPress={() => choose("receive")}
          />
        </View>

        <View className="mt-1 h-5 justify-center">
          {error ? (
            <Typography variant="body" className="text-destructive">
              {error}
            </Typography>
          ) : isLoading ? (
            <Typography variant="body" className="text-foreground/30">
              Finding the best price…
            </Typography>
          ) : quote ? (
            <Typography variant="body" className="text-foreground/30">
              At least{" "}
              {formatRawAmount(quote.minOutAmountRaw, receiveToken.decimals)}{" "}
              {receiveToken.symbol}
              {quote.venue ? ` · via ${quote.venue}` : ""}
            </Typography>
          ) : null}
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
        accessibilityLabel="Confirm swap"
        disabled={!canReview || isExecuting}
        onPress={confirm}
        className={cn(
          "mb-2 mt-4 items-center rounded-full py-5",
          canReview && !isExecuting ? "bg-primary" : "bg-primary/40"
        )}
      >
        <Typography
          variant="title2"
          weight="600"
          className="text-primary-foreground"
        >
          {isExecuting ? "Confirming…" : "Swap"}
        </Typography>
      </HapticPressable>

      <View className="absolute left-5 top-[16px]">
        <GlassButton
          radius={999}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          className="size-11 items-center justify-center rounded-full"
          fallbackClassName=""
        >
          <Ionicons name="chevron-back" size={22} color={palette.foreground} />
        </GlassButton>
      </View>
    </ScreenLayout>
  );
}

function TokenPill({
  token,
  label,
  onPress,
}: {
  token: SwapToken;
  label: string;
  onPress: () => void;
}) {
  const palette = usePalette();

  return (
    <HapticPressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${token.symbol}`}
      feedback="selection"
      onPress={onPress}
      className="max-w-[55%] flex-row items-center gap-2 rounded-full bg-foreground/[0.04] py-2 pl-2 pr-3"
    >
      <TokenMark
        mint={token.mint}
        label={token.symbol}
        iconUrl={token.iconUrl}
        size={28}
      />
      <Typography
        variant="title2"
        weight="600"
        numberOfLines={1}
        className="shrink"
      >
        {token.symbol}
      </Typography>
      <Ionicons name="chevron-forward" size={16} color={palette.fg(0.3)} />
    </HapticPressable>
  );
}
