import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { GlassButton } from "@/components/ui/atoms/Glass";
import { TokenMark } from "@/components/ui/atoms/TokenMark";
import { Typography } from "@/components/ui/atoms/Typography";
import { ScreenLayout } from "@/components/ui/layout";
import { useFeature } from "@/hooks/useFeature";
import { usePalette } from "@/hooks/usePalette";
import { useBalances } from "@/hooks/useBalances";
import { useSwapQuote } from "@/hooks/useSwapQuote";
import { useExecuteSwap } from "@/hooks/useExecuteSwap";
import { useToast } from "@/contexts/ToastContext";
import {
  formatRawAmount,
  formatRawAmountShort,
  toAmountInput,
  toRawAmount,
  type SwapToken,
} from "@/utils/swap";
import { flipSwapPair, useSwapPair, type SwapSide } from "@/utils/swapPair";
import { cn } from "@/utils/cn";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

/** Long enough to follow a pill across the divider, short enough not to wait on. */
const SWITCH_MS = 320;

/** How far, in points, one pill steps aside to let the other by. */
const PASSING_ROOM = 56;

/** The route survives the flag, so a deep link can still land here. */
export default function SwapRoute() {
  const enabled = useFeature("swap");
  if (!enabled) return <Redirect href="/" />;
  // Every Account can swap. One set up before Swap does it on an allowance
  // from its vault, which the backend chooses and the signing check reads as
  // the same swap, so there is nothing to turn on first.
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

  // Switching the pair is shown, not just done: each pill travels to the
  // other row, so the eye can follow which asset went where. A pill keeps the
  // asset it is carrying for the whole trip. Swapping the contents of two
  // pills that stay put would be the same instant change with a delay.
  const [switched, setSwitched] = useState(false);
  const [rowWidth, setRowWidth] = useState(0);
  const travelled = useSharedValue(0);
  const payRowY = useSharedValue(0);
  const receiveRowY = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  // Each animated view below carries its animated style and nothing else.
  // A class name on the same view is resolved into that style prop too, and
  // the two together overflow the stack when the animation is inspected.
  const upperPillStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: travelled.value * (receiveRowY.value - payRowY.value) },
      // Swings wide of the other pill on the way, so the two pass each other
      // instead of sliding through one another.
      { translateX: -Math.sin(Math.PI * travelled.value) * PASSING_ROOM },
    ],
  }));
  const lowerPillStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: travelled.value * (payRowY.value - receiveRowY.value) },
    ],
  }));
  const switchIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${travelled.value * 180}deg` }],
  }));

  const switchPair = () => {
    const next = !switched;
    setSwitched(next);
    flipSwapPair();
    travelled.value = reduceMotion
      ? Number(next)
      : withTiming(Number(next), {
          duration: SWITCH_MS,
          easing: Easing.bezier(0.65, 0, 0.35, 1),
        });
  };
  // The pill laid out in the upper row sits in the lower one once switched,
  // and so stands for the other side of the swap.
  const upperSide: SwapSide = switched ? "receive" : "pay";
  const lowerSide: SwapSide = switched ? "pay" : "receive";
  const sideToken = (side: SwapSide) =>
    side === "pay" ? payToken : receiveToken;
  const sideLabel = (side: SwapSide) =>
    side === "pay" ? "Choose what you pay with" : "Choose what you receive";

  const heldRaw = useMemo(
    () => tokens.find((t) => t.mint === payToken.mint)?.amountRaw ?? "0",
    [tokens, payToken.mint]
  );
  // The label is a short reminder of what is held. Tapping MAX fills the
  // exact balance, to the last decimal place, whatever the label shows.
  const payBalance = formatRawAmountShort(heldRaw, payToken.decimals);

  const amountRaw = useMemo(
    () => toRawAmount(amount, payToken.decimals),
    [amount, payToken.decimals]
  );
  // Compared as whole numbers of the smallest unit, so the full balance is
  // within the balance and one unit more is not.
  const withinBalance =
    amountRaw !== "0" && BigInt(amountRaw) <= BigInt(heldRaw);

  const payEverything = () => {
    if (heldRaw === "0") return;
    setAmount(toAmountInput(heldRaw, payToken.decimals));
  };

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
        <View
          className="z-10 flex-row items-center justify-between"
          onLayout={(event) => {
            payRowY.value = event.nativeEvent.layout.y;
            setRowWidth(event.nativeEvent.layout.width);
          }}
        >
          <Amount
            value={amount}
            dimmed={amount === "0"}
            fadeFrom={rowWidth / 2}
          />
          <View className="max-w-[55%]">
            <Animated.View style={upperPillStyle}>
              <TokenPill
                token={sideToken(upperSide)}
                label={sideLabel(upperSide)}
                onPress={() => choose(upperSide)}
              />
            </Animated.View>
          </View>
        </View>
        <HapticPressable
          accessibilityRole="button"
          accessibilityLabel={`Pay with all of it, ${payBalance} ${payToken.symbol}`}
          feedback="selection"
          onPress={payEverything}
          hitSlop={10}
          className="mt-1 flex-row items-center gap-1 self-end"
        >
          <Typography variant="body" weight="600">
            MAX
          </Typography>
          <Typography variant="body" className="text-foreground/30">
            {payBalance}
          </Typography>
        </HapticPressable>

        <View className="my-5 flex-row items-center gap-3">
          <View className="h-px flex-1 bg-foreground/10" />
          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel="Swap direction"
            feedback="selection"
            onPress={switchPair}
            hitSlop={12}
          >
            <Animated.View style={switchIconStyle}>
              <Ionicons
                name="swap-vertical"
                size={22}
                color={palette.foreground}
              />
            </Animated.View>
          </HapticPressable>
          <View className="h-px flex-1 bg-foreground/10" />
        </View>

        <Typography variant="body" weight="600" className="mb-2">
          You receive
        </Typography>
        <View
          className="z-10 flex-row items-center justify-between"
          onLayout={(event) => {
            receiveRowY.value = event.nativeEvent.layout.y;
          }}
        >
          <Amount
            value={receiveDisplay}
            dimmed={!quote}
            fadeFrom={rowWidth / 2}
          />
          <View className="max-w-[55%]">
            <Animated.View style={lowerPillStyle}>
              <TokenPill
                token={sideToken(lowerSide)}
                label={sideLabel(lowerSide)}
                onPress={() => choose(lowerSide)}
              />
            </Animated.View>
          </View>
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

/**
 * An amount on one side of the swap.
 *
 * It keeps its size however long it gets. A long one thins out gradually:
 * solid up to the middle of the row, where the switch control sits, and from
 * there fading steadily into the background until nothing is left by the
 * time it would reach the token pill. A short fade would read as the number
 * being cut off; a long one reads as it trailing away.
 */
function Amount({
  value,
  dimmed,
  fadeFrom,
}: {
  value: string;
  dimmed: boolean;
  /** Where the fade begins, in points from the left of the row. */
  fadeFrom: number;
}) {
  const palette = usePalette();

  return (
    <View className="mr-3 flex-1 overflow-hidden">
      <Typography
        weight="500"
        numberOfLines={1}
        ellipsizeMode="clip"
        className={cn(
          "text-[44px] tracking-[-1.2px]",
          dimmed ? "text-foreground/25" : "text-foreground"
        )}
      >
        {value}
      </Typography>
      {fadeFrom > 0 ? (
        <View
          pointerEvents="none"
          className="absolute bottom-0 right-0 top-0"
          // MEASURED-LAYOUT: the fade starts at the middle of the row.
          style={{ left: fadeFrom }}
        >
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="amount-fade" x1="0" y1="0" x2="1" y2="0">
                <Stop
                  offset="0"
                  stopColor={palette.background}
                  stopOpacity="0"
                />
                <Stop
                  offset="0.9"
                  stopColor={palette.background}
                  stopOpacity="1"
                />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#amount-fade)" />
          </Svg>
        </View>
      ) : null}
    </View>
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
      className="flex-row items-center gap-2 rounded-full bg-foreground/[0.04] py-2 pl-2 pr-3"
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
