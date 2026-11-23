import React, { useCallback, useEffect } from "react";
import { Image, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FrostBlurView } from "@/components/ui/atoms/FrostBlurView";
import { GlassButton } from "@/components/ui/atoms/Glass";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { TokenMark } from "@/components/ui/atoms/TokenMark";
import { Typography } from "@/components/ui/atoms/Typography";
import { useSurface } from "@/components/ui/glass";
import { useBalances } from "@/hooks/useBalances";
import { earnHeadlineApy, useEarnPosition } from "@/hooks/useEarn";
import { useFeature } from "@/hooks/useFeature";
import { useInvestments } from "@/hooks/useInvestments";
import { usePalette } from "@/hooks/usePalette";
import { formatMoney } from "@/utils/balances";
import { cn } from "@/utils/cn";

/**
 * Where Home's total sits, in points from the screen's top left. The page
 * grows out of this point so it reads as the total opening up, not as a new
 * screen arriving.
 */
const ORIGIN = { x: 20, y: 120 };
const CLOSED_SCALE = 0.72;
const OPEN_SPRING = { damping: 19, stiffness: 210, mass: 0.9 };
const CLOSE_MS = 180;
const HOLDINGS_SHOWN = 3;

/**
 * What the total balance is made of, laid over a blurred Home: Cash and
 * Investments as what the Consumer has, Earn as what it could be doing.
 */
export default function BalanceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const reduceMotion = useReducedMotion();
  const swapEnabled = useFeature("swap");
  const { portfolio, isError, isLoading, refetch } = useBalances();
  const investmentsNote = isError
    ? "Couldn't load. Tap to retry"
    : isLoading
      ? "Checking what you hold"
      : "Hold assets alongside your dollars";
  const { balance: earnBalance } = useEarnPosition();
  const { holdings } = useInvestments();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = reduceMotion
      ? withTiming(1, { duration: CLOSE_MS })
      : withSpring(1, OPEN_SPRING);
  }, [progress, reduceMotion]);

  const goBack = useCallback(() => router.back(), [router]);
  const close = useCallback(() => {
    progress.value = withTiming(
      0,
      { duration: CLOSE_MS, easing: Easing.out(Easing.quad) },
      (finished) => {
        if (finished) runOnJS(goBack)();
      }
    );
  }, [goBack, progress]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.6], [0, 1], "clamp"),
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.5], [0, 1], "clamp"),
    transform: reduceMotion
      ? []
      : [{ scale: interpolate(progress.value, [0, 1], [CLOSED_SCALE, 1]) }],
  }));

  // A failed read leaves the portfolio at zero, which must not be shown as an
  // empty account.
  const fromWallet = (usd: number) => (isError ? "—" : `$${formatMoney(usd)}`);
  const shownHoldings = holdings.slice(0, HOLDINGS_SHOWN);
  const moreHoldings = holdings.length - shownHoldings.length;

  return (
    <View className="flex-1">
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
        <FrostBlurView style={StyleSheet.absoluteFill}>
          <View className="flex-1 bg-background/60" />
        </FrostBlurView>
      </Animated.View>

      {/* Reanimated's style cannot share a view with NativeWind's className,
      so the two animated layers are placed by style alone. */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { transformOrigin: [ORIGIN.x, insets.top + ORIGIN.y, 0] },
          contentStyle,
        ]}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerClassName="px-5"
          contentContainerStyle={{
            paddingTop: insets.top + 12,
            paddingBottom: insets.bottom + 24,
          }}
        >
          <GlassButton
            radius={999}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
            onPress={close}
            className="h-9 w-9 items-center justify-center rounded-full"
          >
            <Ionicons name="close" size={20} color={palette.foreground} />
          </GlassButton>

          <SectionTitle>Your money</SectionTitle>
          <Card
            accessibilityLabel={`Cash, ${fromWallet(portfolio.cashUsd)}`}
            onPress={() => router.push("/cash")}
          >
            <CardCaption>Cash</CardCaption>
            <Row
              mark={
                <Image
                  source={require("@/assets/icons/usdc.png")}
                  className="size-10"
                  resizeMode="contain"
                />
              }
              title="US dollars"
              subtitle="Ready to spend or send"
              trailing={<Amount>{fromWallet(portfolio.cashUsd)}</Amount>}
            />
          </Card>

          {swapEnabled &&
            (shownHoldings.length > 0 ? (
              <Card
                accessibilityLabel={`Investments, ${fromWallet(portfolio.investmentsUsd)}`}
                onPress={() => router.push("/investments")}
              >
                <View className="flex-row items-center justify-between">
                  <CardCaption>Investments</CardCaption>
                  <CardCaption>
                    {fromWallet(portfolio.investmentsUsd)}
                  </CardCaption>
                </View>
                {shownHoldings.map((holding) => (
                  <Row
                    key={holding.mint}
                    mark={
                      <TokenMark
                        mint={holding.mint}
                        label={holding.name}
                        iconUrl={holding.iconUrl}
                        size={40}
                      />
                    }
                    title={holding.name}
                    trailing={
                      <Amount>
                        {holding.usdValue == null
                          ? "Unpriced"
                          : `$${formatMoney(holding.usdValue)}`}
                      </Amount>
                    }
                  />
                ))}
                {moreHoldings > 0 && (
                  <CardCaption>{`and ${moreHoldings} more`}</CardCaption>
                )}
              </Card>
            ) : (
              // No holdings is only "nothing held" once the read has answered.
              // While it is pending or has failed, what the Consumer holds is
              // unknown, and saying so beats offering them an empty account.
              <Card
                accessibilityLabel={`Investments, ${investmentsNote.toLowerCase()}`}
                onPress={
                  isError ? () => refetch() : () => router.push("/investments")
                }
              >
                <Row
                  mark={
                    <Image
                      source={require("@/assets/icons/investment.png")}
                      className="size-10 rounded-xl"
                    />
                  }
                  title="Investments"
                  subtitle={investmentsNote}
                  trailing={
                    isError || isLoading ? (
                      <Amount>—</Amount>
                    ) : (
                      <Pill>Discover</Pill>
                    )
                  }
                />
              </Card>
            ))}

          <SectionTitle>Grow</SectionTitle>
          <Card
            accessibilityLabel={
              earnBalance > 0
                ? `Earn, $${formatMoney(earnBalance)}`
                : `Earn, ${earnHeadlineApy()} a year`
            }
            onPress={() => router.push("/earn")}
          >
            <Row
              mark={
                <Image
                  source={require("@/assets/icons/earn.png")}
                  className="size-10 rounded-xl"
                />
              }
              title="Earn"
              subtitle={`${earnHeadlineApy()} a year on your dollars`}
              trailing={
                earnBalance > 0 ? (
                  <Amount>{`$${formatMoney(earnBalance)}`}</Amount>
                ) : (
                  <Pill>Discover</Pill>
                )
              }
            />
          </Card>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  const S = useSurface();
  return (
    <Typography weight="600" className={cn("pb-3 pt-7 text-lg", S.ink)}>
      {children}
    </Typography>
  );
}

function Card({
  children,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const S = useSurface();
  return (
    <HapticPressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className={cn("mb-2.5 gap-3.5 p-4", S.card)}
      // PLATFORM-SHADOW
      style={S.raised}
    >
      {children}
    </HapticPressable>
  );
}

function CardCaption({ children }: { children: string }) {
  const S = useSurface();
  return (
    <Typography weight="500" className={cn("text-sm", S.caption)}>
      {children}
    </Typography>
  );
}

function Row({
  mark,
  title,
  subtitle,
  trailing,
}: {
  mark: React.ReactNode;
  title: string;
  subtitle?: string;
  trailing: React.ReactNode;
}) {
  const S = useSurface();
  return (
    <View className="flex-row items-center gap-3">
      {mark}
      <View className="flex-1">
        <Typography
          weight="600"
          className={cn("text-base", S.ink)}
          numberOfLines={1}
        >
          {title}
        </Typography>
        {subtitle && (
          <Typography className={cn("text-sm", S.caption)} numberOfLines={2}>
            {subtitle}
          </Typography>
        )}
      </View>
      {trailing}
    </View>
  );
}

function Amount({ children }: { children: string }) {
  const S = useSurface();
  return (
    <Typography weight="600" className={cn("text-base", S.ink)}>
      {children}
    </Typography>
  );
}

function Pill({ children }: { children: string }) {
  const S = useSurface();
  return (
    <View className={cn("rounded-full px-3.5 py-2", S.quietPill)}>
      <Typography weight="600" className={cn("text-sm", S.ink)}>
        {children}
      </Typography>
    </View>
  );
}
