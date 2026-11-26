import React, { useEffect, useMemo, useRef, useState } from "react";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { ActivityIndicator, Linking, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";

import { EarnFlow, type EarnFlowState } from "@/components/earn/EarnFlow";
import { TokenPriceChart } from "@/components/token/TokenPriceChart";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { GlassButton } from "@/components/ui/atoms/Glass";
import { TokenMark } from "@/components/ui/atoms/TokenMark";
import { Typography } from "@/components/ui/atoms/Typography";
import { ScreenLayout } from "@/components/ui/layout";
import { ActionPill } from "@/components/ui/molecules/ActionPill";
import { ActivityItem } from "@/components/ui/organisms/ActivityItem";
import { SendModal } from "@/components/ui/organisms/modals/SendModal";
import { TransactionDetailModal } from "@/components/ui/organisms/modals/TransactionDetailModal";
import { SendFlowModal } from "@/components/ui/organisms/send/SendFlowModal";
import { useBalances } from "@/hooks/useBalances";
import {
  useEarnPosition,
  useEarnProducts,
  useTokenOverview,
} from "@/hooks/useEarn";
import { useFeature } from "@/hooks/useFeature";
import { usePalette } from "@/hooks/usePalette";
import { useSendGate } from "@/hooks/useSendGate";
import { useTransfersInfinite } from "@/hooks/useTransfers";
import { useWalletAddress } from "@/hooks/useWalletAddress";
import {
  mapTransferRowsToActivityEntries,
  type ActivityEntry,
} from "@/utils/activity";
import { cn } from "@/utils/cn";
import { pickSwapToken } from "@/utils/swapPair";
import { SEED_DEMO } from "@/utils/devSeed";
import {
  EarnProviderSchema,
  earnDepositLimit,
  type TokenRange,
} from "@/utils/earn";
import { formatEarnMoney } from "@/utils/earnProjection";
import { describeToken, formatTokenAmount } from "@/utils/tokens";

const ACTIVITY_TARGET = 10;
const AUTO_PAGES = 8;

const RANGES: { id: TokenRange; label: string }[] = [
  { id: "1d", label: "1D" },
  { id: "1w", label: "1W" },
  { id: "1m", label: "1M" },
  { id: "6m", label: "6M" },
  { id: "1y", label: "1Y" },
];

/**
 * One token: how much of it the Consumer has and where, what it is worth, and
 * what they have done with it. Opened from Investments, its actions are Swap
 * and Send; opened from an Earn position (`earn` set), Deposit and Withdraw
 * with this token already chosen.
 */
export default function TokenScreen() {
  const params = useLocalSearchParams<{ mint: string; earn?: string }>();
  const mint = params.mint;
  const earn = EarnProviderSchema.safeParse(params.earn);
  const router = useRouter();
  const palette = usePalette();
  const swapEnabled = useFeature("swap");
  const depositsEnabled = useFeature("earnDeposits");
  const gateSend = useSendGate();
  const address = useWalletAddress();
  const sendFlowModalRef = useRef<BottomSheetModal>(null);
  const [sending, setSending] = useState(false);
  const [range, setRange] = useState<TokenRange>("1d");
  const [flow, setFlow] = useState<EarnFlowState | null>(null);
  const [opened, setOpened] = useState<ActivityEntry | null>(null);

  const balances = useBalances();
  const { products } = useEarnProducts();
  const { positionsRead, depositableMinor, withdrawableBalances } =
    useEarnPosition();
  const overview = useTokenOverview(mint, range);
  const transfers = useTransfersInfinite();

  const held = balances.tokens.find((token) => token.mint === mint);
  // Every product lending this token, closed positions included: a position
  // withdrawn to zero still has what it earned.
  const lending = products.flatMap((product) =>
    product.assets
      .filter(
        (asset) =>
          asset.mint === mint && (!earn.success || product.id === earn.data)
      )
      .map((asset) => ({ product, asset }))
  );
  const lentIn = lending.filter((row) => (row.asset.position ?? 0) > 0);
  const earnProduct = earn.success
    ? products.find((product) => product.id === earn.data)
    : undefined;
  const known =
    earnProduct?.assets.find((asset) => asset.mint === mint) ??
    lentIn[0]?.asset;
  const named = describeToken(
    mint,
    held?.symbol ?? known?.symbol ?? overview.data?.symbol ?? undefined,
    held?.name ?? known?.name ?? overview.data?.name ?? undefined
  );
  const decimals =
    held?.decimals ?? known?.decimals ?? overview.data?.decimals ?? 6;
  const iconUrl =
    held?.iconUrl ?? known?.iconUrl ?? overview.data?.iconUrl ?? null;

  const available = held ? Number(held.amountRaw) / 10 ** held.decimals : 0;
  const lent = lentIn.reduce((sum, row) => sum + (row.asset.position ?? 0), 0);
  const earned = lending.reduce(
    (sum, row) => sum + (row.asset.lifetimeEarned ?? 0),
    0
  );
  const total = available + lent;
  const price =
    overview.data?.priceUsd ??
    (held?.usdValue != null && available > 0
      ? held.usdValue / available
      : null);
  const change = overview.data?.priceChange24h ?? held?.priceChange24h ?? null;
  const prices = (overview.data?.points ?? []).map((point) => point.priceUsd);

  const entries = useMemo(() => {
    const rows = transfers.data?.pages.flatMap((page) => page.transfers) ?? [];
    return mapTransferRowsToActivityEntries(rows, {
      selfAddress: address ?? "",
      decimalsByMint: balances.decimalsByMint,
      iconsByMint: balances.iconsByMint,
    }).filter(
      (entry) =>
        entry.mint === mint ||
        entry.swap?.pay.mint === mint ||
        entry.swap?.receive.mint === mint
    );
  }, [
    transfers.data,
    address,
    balances.decimalsByMint,
    balances.iconsByMint,
    mint,
  ]);

  // The feed is wallet-wide and paged, so a token's history can sit past the
  // first page. Older pages load until a screenful of this token's entries
  // turns up or the feed runs out; after that, "Show older" goes further.
  const pagesLoaded = transfers.data?.pages.length ?? 0;
  const searching =
    !!transfers.hasNextPage &&
    entries.length < ACTIVITY_TARGET &&
    pagesLoaded < AUTO_PAGES;
  useEffect(() => {
    if (searching && !transfers.isFetchingNextPage)
      void transfers.fetchNextPage();
  }, [searching, transfers]);

  const lentLabel = earnProduct ? `In ${earnProduct.provider}` : "In Earn";
  // Only a token some product lends has an Earn side worth showing.
  const lendable = products.some((product) =>
    product.assets.some((asset) => asset.mint === mint)
  );
  const units = (amount: number) =>
    `${formatTokenAmount(amount, decimals)} ${named.symbol}`;

  const actions = earnProduct
    ? [
        {
          icon: () => <PillLabel icon="add" label="Deposit" />,
          onPress: () =>
            setFlow({ step: "deposit", productId: earnProduct.id, mint }),
          accessibilityLabel: `Deposit ${named.symbol}`,
        },
        {
          icon: () => <PillLabel icon="arrow-up" label="Withdraw" />,
          onPress: () =>
            setFlow({ step: "withdraw", productId: earnProduct.id, mint }),
          accessibilityLabel: `Withdraw ${named.symbol}`,
        },
      ]
    : [
        ...(swapEnabled
          ? [
              {
                icon: () => <PillLabel icon="swap-horizontal" label="Swap" />,
                onPress: () => {
                  // Swap keeps its own pair, so it would otherwise open on
                  // whatever was last chosen there.
                  pickSwapToken("pay", {
                    mint,
                    symbol: named.symbol,
                    name: named.name,
                    decimals,
                    iconUrl,
                  });
                  router.push("/swap");
                },
                accessibilityLabel: "Swap",
              },
            ]
          : []),
        {
          icon: () => <PillLabel icon="paper-plane" label="Send" />,
          onPress: () => gateSend(() => setSending(true)),
          accessibilityLabel: "Send",
        },
      ];

  return (
    <ScreenLayout>
      <View className="flex-row items-center gap-3">
        <TokenMark
          mint={mint}
          label={named.symbol}
          iconUrl={iconUrl}
          size={36}
        />
        <Typography variant="title2" weight="600">
          {named.name}
        </Typography>
      </View>

      <ScrollView
        className="mt-6 flex-1"
        contentContainerClassName="pb-28"
        showsVerticalScrollIndicator={false}
      >
        <Typography variant="body" className="text-foreground/40">
          Balance
        </Typography>
        <View className="flex-row items-baseline gap-2">
          <Typography variant="h3" weight="700">
            {formatTokenAmount(total, decimals)}
          </Typography>
          <Typography variant="h3" weight="700" className="text-foreground/30">
            {named.symbol}
          </Typography>
        </View>
        {price !== null && (
          <Typography variant="body" weight="600" className="mt-1">
            {formatEarnMoney(total * price)}
          </Typography>
        )}

        <Typography variant="title2" weight="600" className="mb-3 mt-8">
          Overview
        </Typography>
        <View className="h-1.5 flex-row overflow-hidden rounded-full bg-foreground/10">
          {total > 0 && (
            <>
              <View
                className="bg-foreground"
                style={{ flex: available / total }}
              />
              <View
                className="bg-foreground/30"
                style={{ flex: lent / total }}
              />
            </>
          )}
        </View>
        <View className="mt-4 gap-3">
          <OverviewRow
            dot="bg-foreground"
            label="Available"
            value={units(available)}
          />
          {lendable && (
            <>
              <OverviewRow
                dot="bg-foreground/30"
                label={lentLabel}
                value={units(lent)}
                muted={lent === 0}
              />
              <OverviewRow
                dot="bg-foreground/10"
                label="Earned"
                value={units(earned)}
                muted={earned === 0}
              />
            </>
          )}
        </View>

        <View className="mt-8 border-t border-foreground/5 pt-6">
          <View className="flex-row items-center gap-2">
            <Typography variant="body" weight="600">
              {named.symbol}
            </Typography>
            <Typography variant="body" className="text-foreground/20">
              •
            </Typography>
            <Typography variant="body" weight="600">
              USD
            </Typography>
          </View>
          <View className="mt-2 flex-row items-center justify-between">
            <Typography variant="h3" weight="700">
              {price === null ? "—" : formatPrice(price)}
            </Typography>
            {change !== null && (
              <Typography
                variant="body"
                weight="600"
                className={cn(
                  change > 0
                    ? "text-success"
                    : change < 0
                      ? "text-destructive"
                      : "text-foreground/40"
                )}
              >
                {change > 0 ? "↗" : change < 0 ? "↘" : ""}{" "}
                {Math.abs(change).toFixed(2)}%
              </Typography>
            )}
          </View>
          <View className="mt-6">
            {overview.isError ? (
              <View className="h-[180px] items-center justify-center gap-3">
                <Typography variant="body" className="text-foreground/50">
                  Price history could not be loaded.
                </Typography>
                <HapticPressable
                  accessibilityRole="button"
                  onPress={() => {
                    void overview.refetch();
                  }}
                  className="rounded-full bg-foreground/5 px-4 py-2"
                >
                  <Typography variant="body" weight="600">
                    Try again
                  </Typography>
                </HapticPressable>
              </View>
            ) : (
              <TokenPriceChart prices={overview.isPending ? [] : prices} />
            )}
          </View>
          <View className="mt-6 flex-row items-center justify-center gap-2">
            {RANGES.map((option) => {
              const active = option.id === range;
              return (
                <HapticPressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${option.label} price`}
                  accessibilityState={{ selected: active }}
                  onPress={() => setRange(option.id)}
                  feedback="selection"
                  scaleOnPress={false}
                  className={cn(
                    "rounded-full px-2 py-0.5",
                    active ? "bg-foreground/5" : "bg-transparent"
                  )}
                >
                  <Typography
                    weight={active ? "600" : "500"}
                    className={cn(
                      "text-sm",
                      active ? "text-foreground" : "text-foreground/30"
                    )}
                  >
                    {option.label}
                  </Typography>
                </HapticPressable>
              );
            })}
          </View>
        </View>

        <View className="mt-8 gap-4 border-t border-foreground/5 pt-6">
          <DetailRow
            label="Volume 24h"
            value={
              overview.data?.volume24hUsd == null
                ? "—"
                : compactUsd(overview.data.volume24hUsd)
            }
          />
          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel="Copy mint address"
            onPress={() => {
              void Clipboard.setStringAsync(mint);
            }}
            className="flex-row items-center justify-between"
          >
            <Typography variant="body" className="text-foreground/40">
              Mint address
            </Typography>
            <View className="flex-row items-center gap-2">
              <Typography variant="body" weight="600">
                {mint.slice(0, 4)}…{mint.slice(-4)}
              </Typography>
              <Ionicons name="copy" size={14} color={palette.fg(0.35)} />
            </View>
          </HapticPressable>
          <HapticPressable
            accessibilityRole="link"
            onPress={() => {
              void Linking.openURL(`https://solscan.io/token/${mint}`);
            }}
            className="flex-row items-center justify-center gap-1 pt-2"
          >
            <Typography variant="body" weight="600">
              See more
            </Typography>
            <Ionicons name="arrow-up" size={14} color={palette.foreground} />
          </HapticPressable>
        </View>

        {(entries.length > 0 || searching) && (
          <View className="mt-8 border-t border-foreground/5 pt-6">
            <Typography variant="title2" weight="600" className="mb-2">
              Activity
            </Typography>
            {entries.map((entry) => (
              <ActivityItem
                key={entry.id}
                {...entry}
                onPress={() => setOpened(entry)}
              />
            ))}
            {searching ? (
              <View className="mt-3 items-center">
                <ActivityIndicator color={palette.fg(0.4)} />
              </View>
            ) : (
              transfers.hasNextPage && (
                <HapticPressable
                  accessibilityRole="button"
                  onPress={() => {
                    void transfers.fetchNextPage();
                  }}
                  className="mt-3 items-center py-2"
                >
                  <Typography variant="body" weight="600">
                    Show older
                  </Typography>
                </HapticPressable>
              )
            )}
          </View>
        )}
      </ScrollView>

      <View className="absolute bottom-2 left-5 right-5 flex-row items-center justify-between">
        <GlassButton
          radius={999}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          className="h-14 w-14 items-center justify-center rounded-full"
        >
          <Ionicons name="chevron-back" size={22} color={palette.foreground} />
        </GlassButton>
        {!flow && <ActionPill liquid items={actions} />}
      </View>

      <TransactionDetailModal
        visible={!!opened}
        onClose={() => setOpened(null)}
        item={opened}
      />

      {earnProduct ? (
        <EarnFlow
          flow={flow}
          products={products}
          available={
            SEED_DEMO
              ? Math.floor(balances.usdc * 100) / 100
              : earnDepositLimit(depositableMinor)
          }
          positionBalances={withdrawableBalances}
          balanceReady={
            flow?.step === "withdraw"
              ? positionsRead
              : SEED_DEMO
                ? !balances.isLoading && !balances.isError
                : depositableMinor !== null
          }
          depositsEnabled={depositsEnabled}
          onChange={setFlow}
        />
      ) : (
        <>
          <SendModal
            visible={sending}
            onClose={() => setSending(false)}
            cryptoOnly
            onSendToWallet={() => {
              setSending(false);
              sendFlowModalRef.current?.present();
            }}
          />
          <SendFlowModal
            ref={sendFlowModalRef}
            onClose={() => {}}
            initialMint={mint}
          />
        </>
      )}
    </ScreenLayout>
  );
}

function PillLabel({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  const palette = usePalette();
  return (
    <View className="flex-row items-center gap-2">
      <Ionicons name={icon} size={20} color={palette.foreground} />
      <Typography weight="700" className="text-lg">
        {label}
      </Typography>
    </View>
  );
}

function OverviewRow({
  dot,
  label,
  value,
  muted,
}: {
  dot: string;
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between">
      <View className="flex-row items-center gap-3">
        <View className={cn("h-2.5 w-2.5 rounded-full", dot)} />
        <Typography variant="body" weight="500">
          {label}
        </Typography>
      </View>
      <Typography
        variant="body"
        weight="500"
        className={muted ? "text-foreground/30" : undefined}
      >
        {value}
      </Typography>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Typography variant="body" className="text-foreground/40">
        {label}
      </Typography>
      <Typography variant="body" weight="600">
        {value}
      </Typography>
    </View>
  );
}

function formatPrice(price: number) {
  return price.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: price < 1 ? 6 : 2,
  });
}

// Hermes ignores Intl's compact notation, so the suffix is worked out here.
function compactUsd(value: number) {
  const steps: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  const step = steps.find(([size]) => Math.abs(value) >= size);
  if (!step) return `$${value.toFixed(2)}`;
  return `$${Number((value / step[0]).toFixed(2))}${step[1]}`;
}
