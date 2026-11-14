import { ScrollView, View } from "react-native";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { Typography } from "@/components/ui/atoms/Typography";
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useRef, useState } from "react";

import { ScreenLayout } from "@/components/ui/layout";
import { SendModal } from "@/components/ui/organisms/modals/SendModal";
import { ReceiveModal } from "@/components/ui/organisms/modals/ReceiveModal";
import { QRCodeModal } from "@/components/ui/organisms/modals/QRCodeModal";
import { useFeature } from "@/hooks/useFeature";
import { useModalFlow } from "@/contexts/ModalFlowContext";
import { BalanceChart } from "@/components/ui/organisms/BalanceChart";
import { HomeBanners } from "@/components/ui/organisms/HomeBanners";
import { useBalanceDelta, useBalanceHistory } from "@/hooks/useBalanceHistory";
import { earnHeadlineApy, useEarnPosition } from "@/hooks/useEarn";
import { useInvestments, type InvestmentHolding } from "@/hooks/useInvestments";
import { useSendGate } from "@/hooks/useSendGate";
import { formatMoney } from "@/utils/balances";
import { formatTokenAmount } from "@/utils/tokens";
import { TokenMark } from "@/components/ui/atoms/TokenMark";
import { useBalances } from "@/hooks/useBalances";
import { useTransfersInfinite } from "@/hooks/useTransfers";
import { useHomeWidgets } from "@/hooks/useHomeWidgets";
import { useWatchlist } from "@/hooks/useWatchlist";
import { RecentTransactions } from "@/components/ui/organisms/home/RecentTransactions";
import { SpentThisMonth } from "@/components/ui/organisms/home/SpentThisMonth";
import { Watchlist } from "@/components/ui/organisms/home/Watchlist";
import { WidgetsModal } from "@/components/ui/organisms/home/WidgetsModal";
import { TransactionDetailModal } from "@/components/ui/organisms/modals/TransactionDetailModal";
import {
  mapTransferRowToActivityEntry,
  type ActivityEntry,
} from "@/utils/activity";
import { summariseMonthlySpend } from "@/utils/spentThisMonth";
import { useWalletAddress } from "@/hooks/useWalletAddress";
import { useWalletName } from "@/hooks/useWalletName";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { EmptyAccountIllustration } from "@/components/ui/atoms/EmptyAccountIllustration";
import { useRouter } from "expo-router";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { SendFlowModal } from "@/components/ui/organisms/send/SendFlowModal";
import type { SendMode } from "@/components/ui/organisms/send/bankAccount";
import BalanceView from "@/components/BalanceView";
import { cn } from "@/utils/cn";
import {
  GLASS,
  GLASS_COLORS,
  OnPhotoProvider,
  PhotoBackdrop,
} from "@/components/ui/glass";

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

/** Rows under the tiles: holdings first, then what to do next. */
const HOME_ROW_COUNT = 3;

// The spacing the screen was drawn with, in points, before it was made
// scalable: `mt-8` above the chart and `mb-6` below each block.
const CHART_GAP_ABOVE = 28;
const SECTION_GAP = 21;

function HomeScreenContent() {
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
    decimalsByMint,
    iconsByMint,
  } = useBalances();
  const { balance: earnBalance } = useEarnPosition();
  const { holdings } = useInvestments();
  const gateSend = useSendGate();
  const [hidden, setHidden] = useState(false);

  // Everything the Consumer owns, in USD: cash, investments and Earn. The Card
  // joins this sum when it holds a balance of its own.
  const total = portfolio.cashUsd + portfolio.investmentsUsd + earnBalance;
  const totalDisplay = total.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const address = useWalletAddress();
  const { data: transferPages, isLoading: isTransfersLoading } =
    useTransfersInfinite();
  const { visibility, setVisible } = useHomeWidgets();
  const { tokens: watchedTokens } = useWatchlist(visibility.watchlist);
  const [widgetsOpen, setWidgetsOpen] = useState(false);
  const [openEntry, setOpenEntry] = useState<ActivityEntry | null>(null);

  const entries = useMemo(
    () =>
      (transferPages?.pages.flatMap((page) => page.transfers) ?? [])
        .map((row) =>
          mapTransferRowToActivityEntry(row, {
            selfAddress: address ?? "",
            decimalsByMint,
            iconsByMint,
          })
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [transferPages, address, decimalsByMint, iconsByMint]
  );
  const recentEntries = entries.slice(0, 3);
  const monthlySpend = useMemo(() => summariseMonthlySpend(entries), [entries]);
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
  const dayChange =
    delta && hasBalance && !hidden && Math.abs(delta.amount) >= 0.005
      ? delta.amount
      : null;

  return (
    <OnPhotoProvider value>
      <View className="flex-1">
        <PhotoBackdrop />
        <ScreenLayout lightColor="transparent">
          {/* The gutter lives inside the scroll view. Outside it, the view's own
          bounds would shear the shadows off at the screen's left and right. */}
          <ScrollView
            className="-mx-5 flex-1"
            contentContainerClassName="px-5"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingBottom: FLOATING_CHROME_HEIGHT + CHROME_GAP + size(24),
            }}
          >
            <View className="flex-row items-center justify-between pb-6">
              <HapticPressable
                accessibilityRole="button"
                accessibilityLabel="Account settings"
                hitSlop={HEADER_HIT_SLOP}
                onPress={() => router.push("/(tabs)/settings" as never)}
                className={cn(
                  "h-9 w-9 items-center justify-center rounded-full",
                  GLASS.chip
                )}
              >
                <Typography weight="600" className={cn("text-sm", GLASS.ink)}>
                  {initials(walletName)}
                </Typography>
              </HapticPressable>
              <HapticPressable
                accessibilityRole="button"
                accessibilityLabel={hidden ? "Show balances" : "Hide balances"}
                hitSlop={HEADER_HIT_SLOP}
                onPress={() => setHidden((value) => !value)}
                className="h-9 w-9 items-center justify-center"
              >
                <Ionicons
                  name={hidden ? "eye-off-outline" : "eye-outline"}
                  size={22}
                  color={GLASS_COLORS.caption}
                />
              </HapticPressable>
            </View>

            <View>
              <Typography weight="500" className={cn("text-sm", GLASS.caption)}>
                Total Balance
              </Typography>
              {isBalanceError ? (
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
                    <Typography weight="500" className="text-sm text-black/40">
                      Couldn&apos;t load balance. Tap to retry
                    </Typography>
                  </View>
                </HapticPressable>
              ) : (
                <View className="flex-row flex-wrap items-baseline gap-x-2">
                  <Amount
                    hidden={hidden}
                    weight="700"
                    className={cn(
                      "leading-[120%] tracking-[-1.1px]",
                      GLASS.ink
                    )}
                    style={{ fontSize: size(40) }}
                    amount={totalDisplay}
                  />
                  {dayChange !== null && <DayChange amount={dayChange} />}
                </View>
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

            <View
              className="flex-row gap-3"
              style={{ marginBottom: size(SECTION_GAP) }}
            >
              <BalanceTile
                title="Cash"
                amount={formatMoney(portfolio.cashUsd)}
                hint={
                  !known
                    ? null
                    : portfolio.cashUsd > 0
                      ? "₦ and $"
                      : "Add money to start"
                }
                hidden={hidden}
                onPress={() => router.push("/cash")}
              />
              <BalanceTile
                title="Crypto"
                amount={formatMoney(portfolio.investmentsUsd)}
                hint={
                  !swapEnabled || !known || holdings.length > 0
                    ? null
                    : "Buy your first asset"
                }
                change={hidden ? null : cryptoChange24h(holdings)}
                hidden={hidden}
                onPress={() => router.push("/investments")}
              />
            </View>

            {/* Holdings first; a spare row is the next thing worth doing. An Account
            holding only cash still gets the section, as those spare rows. */}
            {visibility.assets &&
              (holdings.length > 0 || (known && hasBalance)) && (
                <View style={{ marginBottom: size(SECTION_GAP) }}>
                  <View className="flex-row items-center justify-between pb-1">
                    <Typography
                      weight="500"
                      className={cn("text-sm", GLASS.caption)}
                    >
                      Your assets
                    </Typography>
                    <HapticPressable
                      accessibilityRole="button"
                      accessibilityLabel="See all assets"
                      hitSlop={12}
                      onPress={() => router.push("/investments")}
                      className="py-1"
                    >
                      <Typography
                        weight="500"
                        className={cn("text-sm", GLASS.copy)}
                      >
                        See all
                      </Typography>
                    </HapticPressable>
                  </View>
                  <View className="gap-2.5 pt-1">
                    {holdings.slice(0, HOME_ROW_COUNT).map((holding) => (
                      <AssetRow
                        key={holding.mint}
                        holding={holding}
                        hidden={hidden}
                        onPress={() => router.push("/investments")}
                      />
                    ))}
                    {holdings.length < HOME_ROW_COUNT && (
                      <PromptRow
                        icon="bar-chart-outline"
                        label="Earn"
                        detail={`Up to ${earnHeadlineApy()} APY`}
                        onPress={() => router.push("/earn")}
                      />
                    )}
                    {swapEnabled && holdings.length < HOME_ROW_COUNT - 1 && (
                      <PromptRow
                        icon="add"
                        label="Buy another asset"
                        detail="Swap cash for crypto"
                        onPress={() => router.push("/swap")}
                      />
                    )}
                  </View>
                </View>
              )}

            {/* Only for an Account known to hold nothing at all. One that holds
            cash but no assets is not empty, and says so in its tiles. */}
            {known && !hasBalance && holdings.length === 0 && (
              <View
                className="items-center pt-6"
                style={{ marginBottom: size(SECTION_GAP) }}
              >
                <EmptyAccountIllustration />
                <Typography
                  weight="600"
                  className={cn("mt-4 text-lg", GLASS.ink)}
                >
                  There is nothing here yet
                </Typography>
                <Typography
                  weight="500"
                  className={cn("mt-1 text-center text-sm", GLASS.copy)}
                >
                  {swapEnabled
                    ? "Money you add and assets you buy show up here"
                    : "Money you add shows up here"}
                </Typography>
              </View>
            )}

            {visibility.transactions && (
              <View style={{ marginBottom: size(SECTION_GAP) }}>
                <RecentTransactions
                  entries={recentEntries}
                  loaded={!isTransfersLoading}
                  onSeeAll={() => router.push("/history")}
                  onOpen={setOpenEntry}
                />
              </View>
            )}

            {visibility.spend && (
              <View style={{ marginBottom: size(SECTION_GAP) }}>
                <SpentThisMonth spend={monthlySpend} hidden={hidden} />
              </View>
            )}

            {visibility.watchlist && (
              <View style={{ marginBottom: size(SECTION_GAP) }}>
                <Watchlist
                  tokens={watchedTokens}
                  onOpen={swapEnabled ? () => router.push("/swap") : undefined}
                />
              </View>
            )}

            <HapticPressable
              accessibilityRole="button"
              accessibilityLabel="Add widgets"
              onPress={() => setWidgetsOpen(true)}
              className={cn(
                "mb-6 flex-row items-center gap-1.5 self-center rounded-full px-5 py-3",
                GLASS.outlinePill
              )}
            >
              <Ionicons name="add" size={18} color={GLASS_COLORS.ink} />
              <Typography weight="600" className={cn("text-sm", GLASS.ink)}>
                Add widgets
              </Typography>
            </HapticPressable>

            <HomeBanners />
          </ScrollView>
          <WidgetsModal
            visible={widgetsOpen}
            onClose={() => setWidgetsOpen(false)}
            visibility={visibility}
            onChange={setVisible}
            preview={{
              holdings,
              latestEntry: recentEntries[0] ?? null,
              spend: monthlySpend,
              watched: watchedTokens,
            }}
          />
          <TransactionDetailModal
            visible={openEntry !== null}
            onClose={() => setOpenEntry(null)}
            item={openEntry}
          />
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
  const up = amount > 0;
  return (
    <Typography
      weight="500"
      className={cn("text-sm", up ? GLASS.up : GLASS.down)}
    >
      {up ? "+" : "-"}${formatMoney(Math.abs(amount))} today
    </Typography>
  );
}

function changeClass(change: number): string {
  return change > 0 ? GLASS.up : change < 0 ? GLASS.down : GLASS.small;
}

function signedPercent(change: number): string {
  return `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
}

function spokenPercent(change: number): string {
  if (change === 0) return "no change";
  return `${change > 0 ? "up" : "down"} ${Math.abs(change).toFixed(1)} percent`;
}

/**
 * How far the priced holdings moved together over 24h, weighted by what each
 * is worth. Null when nothing reports a change, so the tile says nothing
 * rather than "0.0%".
 */
function cryptoChange24h(holdings: InvestmentHolding[]): number | null {
  let now = 0;
  let before = 0;
  for (const holding of holdings) {
    if (holding.usdValue == null || holding.priceChange24h == null) continue;
    now += holding.usdValue;
    before += holding.usdValue / (1 + holding.priceChange24h / 100);
  }
  if (before === 0) return null;
  return ((now - before) / before) * 100;
}

function initials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "P";
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
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
  return (
    <HapticPressable
      accessibilityRole="button"
      onPress={onPress}
      // The site's CTA is a solid white pill with black type; its secondary
      // pills are a white hairline on the photo.
      className={cn(
        "flex-1 items-center rounded-full py-3",
        primary ? "bg-white" : GLASS.outlinePill
      )}
    >
      <Typography
        weight={primary ? "600" : "500"}
        className={cn("text-[15px]", primary ? "text-black" : GLASS.ink)}
      >
        {label}
      </Typography>
    </HapticPressable>
  );
}

function BalanceTile({
  title,
  amount,
  hint,
  change = null,
  hidden,
  onPress,
}: {
  title: string;
  amount: string;
  /** What sits under the amount when there is no change to report. */
  hint: string | null;
  /** Percent moved over 24h. Takes the hint's place when known. */
  change?: number | null;
  hidden: boolean;
  onPress: () => void;
}) {
  const spoken = [
    title,
    hidden ? "hidden" : `$${amount}`,
    change != null ? `${spokenPercent(change)} today` : hint,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <HapticPressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      onPress={onPress}
      className={cn("flex-1 gap-1 p-[18px]", GLASS.card)}
    >
      <Typography weight="500" className={cn("text-[13px]", GLASS.caption)}>
        {title}
      </Typography>
      <Amount
        hidden={hidden}
        weight="500"
        className={cn("text-[22px] tracking-[-0.9px]", GLASS.ink)}
        amount={amount}
      />
      {change != null ? (
        <Typography
          weight="500"
          className={cn("text-[13px]", changeClass(change))}
        >
          {signedPercent(change)} today
        </Typography>
      ) : (
        <Typography weight="500" className={cn("text-[13px]", GLASS.small)}>
          {hint ?? " "}
        </Typography>
      )}
    </HapticPressable>
  );
}

const ROW = cn("flex-row items-center justify-between px-4 py-3", GLASS.card);

function AssetRow({
  holding,
  hidden,
  onPress,
}: {
  holding: InvestmentHolding;
  hidden: boolean;
  onPress: () => void;
}) {
  const change = holding.priceChange24h;
  const units = `${formatTokenAmount(holding.amount, holding.decimals)} ${holding.symbol}`;
  const value = holding.usdValue == null ? null : formatMoney(holding.usdValue);
  const spoken = [
    holding.name,
    units,
    value === null ? "unpriced" : hidden ? "hidden" : `$${value}`,
    change != null ? spokenPercent(change) : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <HapticPressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      onPress={onPress}
      className={ROW}
    >
      <View className="flex-1 flex-row items-center gap-3">
        <TokenMark
          mint={holding.mint}
          label={holding.name}
          iconUrl={holding.iconUrl}
          size={40}
        />
        <View className="flex-1 gap-0.5">
          <Typography
            weight="600"
            className={cn("text-base", GLASS.ink)}
            numberOfLines={1}
          >
            {holding.name}
          </Typography>
          <Typography
            weight="500"
            className={cn("text-[13px]", GLASS.small)}
            numberOfLines={1}
          >
            {units}
          </Typography>
        </View>
      </View>
      <View className="items-end gap-1 pl-3">
        {value === null ? (
          // Nothing could price it. Saying so beats a "$0.00" the Consumer
          // would read as having lost it.
          <Typography weight="600" className={cn("text-base", GLASS.small)}>
            Unpriced
          </Typography>
        ) : (
          <Amount
            hidden={hidden}
            weight="600"
            className={cn("text-base", GLASS.ink)}
            amount={value}
          />
        )}
        {change != null && <ChangePill change={change} />}
      </View>
    </HapticPressable>
  );
}

function ChangePill({ change }: { change: number }) {
  return (
    <View
      className={cn(
        "rounded-full px-2 py-0.5",
        change > 0 ? GLASS.upFill : change < 0 ? GLASS.downFill : GLASS.chip
      )}
    >
      <Typography
        weight="600"
        className={cn("text-[12px]", changeClass(change))}
      >
        {signedPercent(change)}
      </Typography>
    </View>
  );
}

function PromptRow({
  icon,
  label,
  detail,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <HapticPressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${detail}`}
      onPress={onPress}
      className={ROW}
    >
      <View className="flex-row items-center gap-3">
        <View
          className={cn(
            "h-[40px] w-[40px] items-center justify-center rounded-full",
            GLASS.chip
          )}
        >
          <Ionicons name={icon} size={20} color={GLASS_COLORS.ink} />
        </View>
        <View className="gap-0.5">
          <Typography weight="600" className={cn("text-base", GLASS.ink)}>
            {label}
          </Typography>
          <Typography weight="500" className={cn("text-[13px]", GLASS.small)}>
            {detail}
          </Typography>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={GLASS_COLORS.small} />
    </HapticPressable>
  );
}

export default function HomeScreen() {
  return <HomeScreenContent />;
}
