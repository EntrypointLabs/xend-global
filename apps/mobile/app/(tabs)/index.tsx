import { ScrollView, View } from "react-native";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { Typography } from "@/components/ui/atoms/Typography";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";
import { Ionicons } from "@expo/vector-icons";
import React, { useRef, useState } from "react";

import { ScreenLayout } from "@/components/ui/layout";
import { SendModal } from "@/components/ui/organisms/modals/SendModal";
import { ReceiveModal } from "@/components/ui/organisms/modals/ReceiveModal";
import { QRCodeModal } from "@/components/ui/organisms/modals/QRCodeModal";
import { useFeature } from "@/hooks/useFeature";
import { useModalFlow } from "@/contexts/ModalFlowContext";
import { BalanceChart } from "@/components/ui/organisms/BalanceChart";
import { useBalanceDelta, useBalanceHistory } from "@/hooks/useBalanceHistory";
import { earnHeadlineApy, useEarnPosition } from "@/hooks/useEarn";
import { useInvestments } from "@/hooks/useInvestments";
import { useSendGate } from "@/hooks/useSendGate";
import { formatMoney } from "@/utils/balances";
import { useBalances } from "@/hooks/useBalances";
import { useCollapseOnScroll } from "@/hooks/useTabBarCollapse";
import {
  CountryAccountWidget,
  type CountryWidgetAction,
} from "@/components/ui/organisms/home/CountryAccountWidget";
import { BankDetailsSheet } from "@/components/ui/organisms/modals/BankDetailsSheet";
import { useWalletAddress } from "@/hooks/useWalletAddress";
import { useWalletName } from "@/hooks/useWalletName";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { GlassButton, LIQUID_GLASS } from "@/components/ui/atoms/Glass";
import {
  StatusCarousel,
  type StatusItem,
} from "@/components/ui/organisms/home/StatusCarousel";
import { homeNudges, type NudgeKey } from "@/utils/homeNudges";
import { useRouter } from "expo-router";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { SendFlowModal } from "@/components/ui/organisms/send/SendFlowModal";
import type { SendMode } from "@/components/ui/organisms/send/bankAccount";
import BalanceView from "@/components/BalanceView";
import { cn } from "@/utils/cn";
import {
  OnPhotoProvider,
  PhotoBackdrop,
  surfaceFor,
  useOnPhoto,
  useSurface,
} from "@/components/ui/glass";
import { useColorfulTheme } from "@/contexts/AppearanceContext";
import { useDisplayRates } from "@/hooks/useDisplayRates";
import { useCountryCard } from "@/hooks/useCountryCard";
import type { CountryCard } from "@/utils/countryCards";
import type { DisplayRates } from "@/utils/displayRates";
import { formatLocalAmount, formatRateLabel } from "@/utils/displayRates";

// Lifts the 31pt header controls to a 47pt target without growing them.
const HEADER_HIT_SLOP = 8;

// The tab bar and the send button float over the content, anchored at
// `insets.bottom + 8` from the screen edge and 50pt tall. ScreenLayout's
// SafeAreaView has already inset the bottom, so only the part above that inset
// is ours to clear; adding insets.bottom again double-counts it.
const FLOATING_CHROME_HEIGHT = 8 + 50;
// ScreenLayout's own p-5 already sits below this, so the measured gap to the
// chrome is comfortably larger than this number suggests.
const CHROME_GAP = 4;

// The spacing the screen was drawn with, in points, before it was made
// scalable: `mt-8` above the chart and `mb-6` below each block.
const CHART_GAP_ABOVE = 28;
const SECTION_GAP = 21;
const CARD_DROP = 12;

const NUDGE_ART: Record<NudgeKey, Pick<StatusItem, "art">> = {
  earn: { art: "earn" },
  "bank-payout": { art: "bank" },
};

const CARD_ACTION_ROUTES = {
  atm: "/find-atm",
  convert: "/convert-price",
  split: "/split-bill",
  more: "/do-more",
} as const satisfies Record<CountryWidgetAction, string>;

function HomeScreenContent() {
  const colorful = useColorfulTheme();
  // This component creates the photo context, so it reads the theme directly.
  const S = surfaceFor(colorful);
  const router = useRouter();
  const swapEnabled = useFeature("swap");
  const { size } = useResponsiveLayout();
  const {
    showReceiveModal,
    showSendModal,
    isReceiveModalVisible,
    hideAllModals,
    isSendModalVisible,
  } = useModalFlow();
  const {
    portfolio,
    isError: isBalanceError,
    isLoading: isBalanceLoading,
    refetch: refetchBalances,
  } = useBalances();
  const { balance: earnBalance } = useEarnPosition();
  const { holdings } = useInvestments();
  const gateSend = useSendGate();
  const [hidden, setHidden] = useState(false);
  const { data: rates, isError: ratesFailed } = useDisplayRates();
  const countryCard = useCountryCard();
  const collapseOnScroll = useCollapseOnScroll();

  // Everything the Consumer owns, in USD: cash, investments and Earn. The Card
  // joins this sum when it holds a balance of its own.
  const total = portfolio.cashUsd + portfolio.investmentsUsd + earnBalance;
  const totalDisplay = total.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const address = useWalletAddress();
  const accountDetailsRef = useRef<BottomSheetModal>(null);
  const { name: walletName } = useWalletName();
  const sendFlowModalRef = useRef<BottomSheetModal>(null);
  const [sendMode, setSendMode] = useState<SendMode>("crypto");
  const qrCodeModalRef = useRef<BottomSheetModal>(null);

  const history = useBalanceHistory(total);
  const delta = useBalanceDelta(history);
  const hasBalance = total > 0;
  // Loading and a failed read are "unknown", which is not the same as empty:
  // the empty-state copy only belongs on an account known to hold nothing.
  const known = !isBalanceLoading && !isBalanceError;
  const earnDepositsEnabled = useFeature("earnDeposits");
  const nudges: StatusItem[] = homeNudges({
    cashUsd: known ? portfolio.cashUsd : null,
    earnUsd: earnBalance,
    earnDepositsEnabled,
    earnApy: Number.parseFloat(earnHeadlineApy()),
    currency: countryCard?.currency ?? null,
    symbol: countryCard?.symbol ?? null,
    perUsd: countryCard?.currency
      ? rates?.perUsd[countryCard.currency]
      : undefined,
  }).map((nudge) => ({
    ...nudge,
    ...NUDGE_ART[nudge.key],
    onPress:
      nudge.key === "earn"
        ? () => router.push("/earn")
        : () =>
            gateSend(() => {
              setSendMode("bank");
              sendFlowModalRef.current?.present();
            }),
  }));
  const dayChange =
    delta && hasBalance && !hidden && Math.abs(delta.amount) >= 0.005
      ? delta.amount
      : null;

  return (
    <OnPhotoProvider value={colorful}>
      <View className="flex-1">
        {colorful && <PhotoBackdrop />}
        <ScreenLayout lightColor={colorful ? "transparent" : undefined}>
          {/* The gutter lives inside the scroll view. Outside it, the view's own
          bounds would shear the shadows off at the screen's left and right. */}
          <ScrollView
            {...collapseOnScroll}
            // The scroll view clips what it draws, so it starts higher and
            // pads back down: the hide-balance glass and its shadow get room
            // above the first row instead of being cut flat at the edge.
            className="-mx-5 -mt-4 flex-1"
            contentContainerClassName="px-5 pt-4"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingBottom: FLOATING_CHROME_HEIGHT + CHROME_GAP + size(24),
            }}
          >
            <View className="flex-row items-center justify-between pb-6">
              <View className="min-h-9 flex-1 justify-center pr-4">
                <TabHeaderText className="pb-0" numberOfLines={1}>
                  {walletName}
                </TabHeaderText>
              </View>
              <GlassButton
                radius={999}
                accessibilityRole="button"
                accessibilityLabel={hidden ? "Show balances" : "Hide balances"}
                hitSlop={HEADER_HIT_SLOP}
                onPress={() => setHidden((value) => !value)}
                className="h-9 w-9 items-center justify-center rounded-full"
                fallbackClassName=""
              >
                <Ionicons
                  name={hidden ? "eye-off-outline" : "eye-outline"}
                  size={20}
                  color={S.colors.caption}
                />
              </GlassButton>
            </View>

            <View>
              {isBalanceError ? (
                <>
                  <Typography weight="500" className={cn("text-sm", S.caption)}>
                    Total Balance
                  </Typography>
                  <HapticPressable
                    className="flex-row items-center gap-1.5 self-start py-2"
                    onPress={() => refetchBalances()}
                  >
                    <Typography
                      weight="700"
                      className="leading-[120%] tracking-[-1.1px]"
                      style={{ fontSize: size(40) }}
                    >
                      ——
                    </Typography>
                    <View className="flex-row items-center gap-1 rounded-full bg-black/5 px-2.5 py-1">
                      <Ionicons name="refresh" size={14} color="#999" />
                      <Typography
                        weight="500"
                        className="text-sm text-black/40"
                      >
                        Couldn&apos;t load balance. Tap to retry
                      </Typography>
                    </View>
                  </HapticPressable>
                </>
              ) : (
                // The total is the way into its parts: Cash, Investments and
                // Earn each have a page, and Home has no other route to them.
                <HapticPressable
                  accessibilityRole="link"
                  accessibilityLabel={
                    hidden
                      ? "Total balance, hidden"
                      : `Total balance, $${totalDisplay}`
                  }
                  accessibilityHint="Shows what it is made of"
                  onPress={() => router.push("/balance")}
                  className="self-start"
                >
                  <View className="flex-row items-center gap-1">
                    <Typography
                      weight="500"
                      className={cn("text-sm", S.caption)}
                    >
                      Total Balance
                    </Typography>
                    <Ionicons
                      name="chevron-forward"
                      size={13}
                      color={S.colors.caption}
                    />
                  </View>
                  <View className="flex-row flex-wrap items-baseline gap-x-2">
                    <Amount
                      hidden={hidden}
                      weight="700"
                      className={cn("leading-[120%] tracking-[-1.1px]", S.ink)}
                      style={{ fontSize: size(40) }}
                      amount={totalDisplay}
                    />
                    {dayChange !== null && <DayChange amount={dayChange} />}
                  </View>
                </HapticPressable>
              )}
            </View>

            {/* Always drawn, so the screen keeps one shape from the first open to
            the first deposit. With nothing to plot the chart shows its muted
            resting bars, which is what "no data yet" looks like. */}
            <BalanceChart
              loading={isBalanceLoading}
              history={hasBalance ? history : []}
              style={{
                marginTop: size(CHART_GAP_ABOVE),
                marginBottom: size(SECTION_GAP),
              }}
            />

            <View
              className="flex-row gap-2"
              style={{ marginBottom: size(SECTION_GAP) }}
            >
              <ActionButton
                primary
                label="Add money"
                onPress={showReceiveModal}
              />
              <ActionButton
                label="Send"
                onPress={() => gateSend(showSendModal)}
              />
              {swapEnabled && (
                <ActionButton
                  label="Swap"
                  onPress={() => router.push("/swap")}
                />
              )}
            </View>

            <StatusCarousel
              empty={
                known && !hasBalance && holdings.length === 0
                  ? {
                      key: "empty-account",
                      title: "No activity yet",
                      subtitle: swapEnabled
                        ? "Your money and assets show up here"
                        : "Your money shows up here",
                      art: "empty-account",
                    }
                  : null
              }
              nudges={nudges}
              style={{ marginBottom: size(SECTION_GAP) }}
            />

            {countryCard ? (
              <View
                style={{
                  marginTop: size(CARD_DROP),
                  marginBottom: size(SECTION_GAP),
                }}
              >
                <CountryAccountWidget
                  card={countryCard}
                  onAction={(action) => router.push(CARD_ACTION_ROUTES[action])}
                  onPress={() => router.push("/cash")}
                  {...localLabels(
                    countryCard,
                    rates,
                    ratesFailed,
                    known ? portfolio.cashUsd : null,
                    hidden
                  )}
                />
              </View>
            ) : null}

            <HapticPressable
              accessibilityRole="button"
              accessibilityLabel="Account details"
              onPress={() => accountDetailsRef.current?.present()}
              className={cn(
                "mb-6 flex-row items-center gap-1.5 self-center rounded-full px-5 py-3",
                S.quietPill
              )}
            >
              <Ionicons name="wallet-outline" size={17} color={S.colors.ink} />
              <Typography weight="600" className={cn("text-sm", S.ink)}>
                Account details
              </Typography>
            </HapticPressable>
          </ScrollView>
          <BankDetailsSheet ref={accountDetailsRef} variant="account" />
          <SendModal
            visible={isSendModalVisible}
            onClose={hideAllModals}
            onSendToWallet={() => {
              hideAllModals();
              setSendMode("crypto");
              sendFlowModalRef.current?.present();
            }}
            onSendToBank={() => {
              hideAllModals();
              setSendMode("bank");
              sendFlowModalRef.current?.present();
            }}
          />

          <SendFlowModal
            ref={sendFlowModalRef}
            mode={sendMode}
            onClose={() => {}}
          />

          <ReceiveModal
            visible={isReceiveModalVisible}
            onClose={hideAllModals}
            onOpenQRCode={() => qrCodeModalRef.current?.present()}
          />

          <QRCodeModal ref={qrCodeModalRef} walletAddress={address ?? ""} />
        </ScreenLayout>
      </View>
    </OnPhotoProvider>
  );
}

/** Green when the balance grew, red when it fell. Flat is not drawn. */
function DayChange({ amount }: { amount: number }) {
  const S = useSurface();
  const up = amount > 0;
  return (
    <Typography weight="500" className={cn("text-sm", up ? S.up : S.down)}>
      {up ? "+" : "-"}${formatMoney(Math.abs(amount))} today
    </Typography>
  );
}

/**
 * An amount that can be masked without the layout around it moving.
 *
 * Read out as one figure: left alone, the strong and the receding halves are
 * two text nodes and a screen reader pauses between "$2,847." and "50".
 */
function Amount({
  hidden,
  ...props
}: React.ComponentProps<typeof BalanceView> & { hidden: boolean }) {
  if (hidden) {
    const { amount: _amount, ...text } = props;
    return (
      <Typography {...text} accessibilityLabel="Hidden">
        ••••
      </Typography>
    );
  }
  return (
    <View accessible accessibilityLabel={`$${props.amount}`}>
      <BalanceView {...props} />
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  primary = false,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  const S = useSurface();
  const onPhoto = useOnPhoto();
  return (
    <GlassButton
      radius={999}
      accessibilityRole="button"
      onPress={onPress}
      // Add money keeps its weight as tinted glass, the fill it had before;
      // Send and Swap are clear glass.
      tintColor={primary ? (onPhoto ? "#FFFFFF" : "#0A0A0A") : undefined}
      className="flex-1 items-center rounded-full py-3"
      fallbackClassName={primary ? S.primaryButton : S.secondaryButton}
      // PLATFORM-SHADOW
      style={LIQUID_GLASS ? undefined : primary ? S.primaryRaised : S.raised}
    >
      <Typography
        weight="600"
        className={cn(
          "text-[15px]",
          primary ? S.primaryButtonText : S.secondaryButtonText
        )}
      >
        {label}
      </Typography>
    </GlassButton>
  );
}

/**
 * A country card's balance and rate. The balance is the cash that can be spent
 * now, in dollars, shown in the local currency; the rate is against the dollar.
 * Where the local currency is the dollar, or has no rate, both stay in dollars.
 */
function localLabels(
  card: CountryCard,
  rates: DisplayRates | undefined,
  /** The rates request gave up; show dollars rather than waiting forever. */
  ratesFailed: boolean,
  /** Null until the balance has loaded, so a failed read never shows as zero. */
  cashUsd: number | null,
  hidden: boolean
): { balanceLabel: string; rateLabel: string } {
  const { currency, symbol } = card;
  const perUsd = currency ? rates?.perUsd[currency] : undefined;
  const inDollars =
    !currency ||
    !symbol ||
    currency === "USD" ||
    (rates ? !perUsd : ratesFailed);
  if (inDollars) {
    return {
      balanceLabel: hidden
        ? "••••"
        : cashUsd !== null
          ? `$${formatMoney(cashUsd)}`
          : "$…",
      rateLabel: "Spend in USD",
    };
  }
  return {
    balanceLabel: hidden
      ? "••••"
      : perUsd && cashUsd !== null
        ? formatLocalAmount(symbol, cashUsd, perUsd, currency)
        : `${symbol}…`,
    rateLabel: perUsd
      ? formatRateLabel(symbol, perUsd, currency)
      : `${symbol}1 = $…`,
  };
}

export default function HomeScreen() {
  return <HomeScreenContent />;
}
