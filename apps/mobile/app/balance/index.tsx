import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BackHandler,
  Image,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
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
import { OverlayPaneContext } from "@/contexts/OverlayPaneContext";
import { ToastProvider } from "@/contexts/ToastContext";
import CashScreen from "@/app/cash";
import InvestmentsScreen from "@/app/investments";
import { useBalances } from "@/hooks/useBalances";
import { useEarnHeadlineApy, useEarnPosition } from "@/hooks/useEarn";
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
const SLIDE_MS = 340;
const CLOSE_BUTTON = 44;
const HOLDINGS_SHOWN = 3;

/** The screens a card slides in, shown here as panes on the same blur. */
const PANES = {
  cash: CashScreen,
  investments: InvestmentsScreen,
} as const;
type PaneKey = keyof typeof PANES;

/**
 * What the total balance is made of, laid over a blurred Home: Cash and
 * Investments as what the Consumer has, Earn as what it could be doing.
 */
const BALANCE_FROST_INTENSITY = 70;

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
  const earnHeadlineApy = useEarnHeadlineApy();
  const earnRate = earnHeadlineApy > 0 ? `${earnHeadlineApy.toFixed(2)}%` : "—";
  const { holdings } = useInvestments();
  const { width } = useWindowDimensions();
  const progress = useSharedValue(0);
  // 0 with the cards on screen, 1 with a pane slid in over them.
  const slide = useSharedValue(0);
  const [pane, setPane] = useState<PaneKey | null>(null);

  useEffect(() => {
    progress.value = reduceMotion
      ? withTiming(1, { duration: CLOSE_MS })
      : withSpring(1, OPEN_SPRING);
  }, [progress, reduceMotion]);

  const goBack = useCallback(() => router.back(), [router]);
  const goToEarn = useCallback(() => router.replace("/earn"), [router]);
  const closeThen = useCallback(
    (leave: () => void) => {
      const timing = { duration: CLOSE_MS, easing: Easing.out(Easing.quad) };
      // An open pane is not on the fading layer, so it leaves the way it
      // came while the rest fades.
      slide.value = withTiming(0, timing);
      progress.value = withTiming(0, timing, (finished) => {
        if (finished) runOnJS(leave)();
      });
    },
    [progress, slide]
  );
  const close = useCallback(() => closeThen(goBack), [closeThen, goBack]);
  // Earn is a place to do things, not a balance to glance at, so it gets its
  // own page: the overlay closes and Earn takes its place on the stack.
  const openEarn = useCallback(
    () => closeThen(goToEarn),
    [closeThen, goToEarn]
  );

  const open = useCallback(
    (key: PaneKey) => {
      setPane(key);
      slide.value = withTiming(1, {
        duration: SLIDE_MS,
        easing: Easing.out(Easing.cubic),
      });
    },
    [slide]
  );
  const backToCards = useCallback(() => {
    const unmount = () => setPane(null);
    slide.value = withTiming(
      0,
      { duration: SLIDE_MS, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(unmount)();
      }
    );
  }, [slide]);
  const paneContext = useMemo(() => ({ back: backToCards }), [backToCards]);

  useEffect(() => {
    if (!pane) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      backToCards();
      return true;
    });
    return () => sub.remove();
  }, [pane, backToCards]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.6], [0, 1], "clamp"),
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.5], [0, 1], "clamp"),
    transform: reduceMotion
      ? []
      : [{ scale: interpolate(progress.value, [0, 1], [CLOSED_SCALE, 1]) }],
  }));
  // The cards leave to the left as the pane arrives from the right, each
  // fading at its far end so neither is cut off hard at the screen edge.
  // With reduced motion they cross-fade in place.
  const cardsStyle = useAnimatedStyle(() => ({
    opacity: 1 - slide.value,
    transform: reduceMotion ? [] : [{ translateX: -width * slide.value }],
  }));
  // Moved, never faded: the pane's footer is liquid glass, which turns dark
  // grey on a layer whose opacity is animated. Only the reduced-motion
  // cross-fade, where nothing moves, touches its opacity.
  const paneStyle = useAnimatedStyle(() =>
    reduceMotion
      ? { opacity: slide.value }
      : { transform: [{ translateX: width * (1 - slide.value) }] }
  );
  const Pane = pane ? PANES[pane] : null;

  // A failed read leaves the portfolio at zero, which must not be shown as an
  // empty account.
  const fromWallet = (usd: number) => (isError ? "—" : `$${formatMoney(usd)}`);
  const shownHoldings = holdings.slice(0, HOLDINGS_SHOWN);
  const moreHoldings = holdings.length - shownHoldings.length;

  return (
    // This screen is a native modal, so a sheet or toast raised from one of
    // its panes has to be hosted here: the app-wide hosts sit under the modal,
    // where they would show out of sight and out of reach.
    <ToastProvider>
      <BottomSheetModalProvider>
        <View className="flex-1">
          <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
            {/* Heavier than the shared frost: this page is read on top of
                Home, and Home's numbers showing through compete with it. */}
            <FrostBlurView
              veil={false}
              intensity={BALANCE_FROST_INTENSITY}
              style={StyleSheet.absoluteFill}
            >
              <View className="flex-1 bg-background/75" />
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
            <Animated.View
              pointerEvents={pane ? "none" : "auto"}
              style={[StyleSheet.absoluteFill, cardsStyle]}
            >
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerClassName="px-5"
                contentContainerStyle={{
                  paddingTop: insets.top + 8 + CLOSE_BUTTON,
                  paddingBottom: insets.bottom + 24,
                }}
              >
                <SectionTitle>Your money</SectionTitle>
                <Card
                  accessibilityLabel={`Cash, ${fromWallet(portfolio.cashUsd)}`}
                  onPress={() => open("cash")}
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
                    trailing={
                      <Amount link>{fromWallet(portfolio.cashUsd)}</Amount>
                    }
                  />
                </Card>

                {swapEnabled &&
                  (shownHoldings.length > 0 ? (
                    <Card
                      accessibilityLabel={`Investments, ${fromWallet(portfolio.investmentsUsd)}`}
                      onPress={() => open("investments")}
                    >
                      <View className="flex-row items-center justify-between">
                        <CardCaption>Investments</CardCaption>
                        <View className="flex-row items-center gap-1.5">
                          <CardCaption>
                            {fromWallet(portfolio.investmentsUsd)}
                          </CardCaption>
                          <Ionicons
                            name="chevron-forward"
                            size={14}
                            color={palette.fg(0.4)}
                          />
                        </View>
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
                        isError ? () => refetch() : () => open("investments")
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
                    earnBalance !== null && earnBalance > 0
                      ? `Earn, $${formatMoney(earnBalance)}`
                      : earnBalance === null
                        ? "Earn balance unavailable"
                        : `Earn, ${earnRate} a year`
                  }
                  onPress={openEarn}
                >
                  <Row
                    mark={
                      <Image
                        source={require("@/assets/icons/earn.png")}
                        className="size-10 rounded-xl"
                      />
                    }
                    title="Earn"
                    subtitle={`${earnRate} a year on your dollars`}
                    trailing={
                      earnBalance !== null && earnBalance > 0 ? (
                        <Amount link>{`$${formatMoney(earnBalance)}`}</Amount>
                      ) : (
                        <Pill>
                          {earnBalance === null ? "Unavailable" : "Discover"}
                        </Pill>
                      )
                    }
                  />
                </Card>
              </ScrollView>
            </Animated.View>
          </Animated.View>

          {Pane && (
            <Animated.View style={[StyleSheet.absoluteFill, paneStyle]}>
              <OverlayPaneContext.Provider value={paneContext}>
                <Pane />
              </OverlayPaneContext.Provider>
            </Animated.View>
          )}

          {/* On no animated layer at all: it holds still while the others
          move, and its glass is never faded. */}
          <View className="absolute left-5" style={{ top: insets.top + 8 }}>
            <GlassButton
              radius={999}
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={close}
              className="size-11 items-center justify-center rounded-full"
              fallbackClassName="border border-foreground/[0.08] bg-card"
            >
              <Ionicons
                name="close"
                size={22}
                color={palette.dark ? palette.foreground : "#0A0A0A"}
              />
            </GlassButton>
          </View>
        </View>
      </BottomSheetModalProvider>
    </ToastProvider>
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

/** A figure, with the chevron that marks its card as leading somewhere. */
function Amount({
  children,
  link = false,
}: {
  children: string;
  link?: boolean;
}) {
  const S = useSurface();
  const figure = (
    <Typography weight="600" className={cn("text-base", S.ink)}>
      {children}
    </Typography>
  );
  if (!link) return figure;
  return (
    <View className="flex-row items-center gap-1.5">
      {figure}
      <Ionicons name="chevron-forward" size={16} color={S.colors.caption} />
    </View>
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
