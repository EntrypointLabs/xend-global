import React, { useMemo, useState } from "react";
import { Image, Linking, ScrollView, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import BalanceView from "@/components/BalanceView";
import { EarnActionBar } from "@/components/earn/EarnActionBar";
import { EarnBarChart } from "@/components/earn/EarnBarChart";
import { EarnFlow, type EarnFlowState } from "@/components/earn/EarnFlow";
import { apyLabel } from "@/components/earn/EarnProductRows";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { TokenMark } from "@/components/ui/atoms/TokenMark";
import { formatTokenAmount } from "@/utils/tokens";
import { Typography } from "@/components/ui/atoms/Typography";
import { ScreenLayout } from "@/components/ui/layout";
import { useBalances } from "@/hooks/useBalances";
import {
  useEarnHistory,
  useEarnPosition,
  useEarnProducts,
} from "@/hooks/useEarn";
import { useFeature } from "@/hooks/useFeature";
import { usePalette } from "@/hooks/usePalette";
import { cn } from "@/utils/cn";
import { SEED_DEMO } from "@/utils/devSeed";
import {
  EarnProviderSchema,
  earnBars,
  earnDepositLimit,
  type EarnRange,
} from "@/utils/earn";
import { formatEarnMoney } from "@/utils/earnProjection";

const RANGES: { id: EarnRange; label: string }[] = [
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "1y", label: "1Y" },
  { id: "all", label: "ALL" },
];

const RANGE_TITLES: Record<EarnRange, string> = {
  "7d": "Earned in 7 days",
  "30d": "Earned in 30 days",
  "1y": "Earned in 12 months",
  all: "Earned in total",
};

function shortDate(day: string, range: EarnRange) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    ...(range === "7d" || range === "30d" ? { day: "numeric" } : {}),
  });
}

/** One Earn position: what it holds, what it has earned, and the protocol behind it. */
export default function EarnPositionScreen() {
  const params = useLocalSearchParams<{ provider: string }>();
  const provider = EarnProviderSchema.safeParse(params.provider);
  const palette = usePalette();
  const router = useRouter();
  const depositsEnabled = useFeature("earnDeposits");
  const [flow, setFlow] = useState<EarnFlowState | null>(null);
  const [range, setRange] = useState<EarnRange>("7d");
  const { products } = useEarnProducts();
  const balances = useBalances();
  const { balance, depositableMinor, withdrawableBalances } = useEarnPosition();
  const history = useEarnHistory(
    provider.success ? provider.data : "kamino",
    range
  );
  const [today] = useState(() => new Date());
  const chart = useMemo(
    () => earnBars(history.data?.points ?? [], range, today),
    [history.data, range, today]
  );

  const product = provider.success
    ? products.find((p) => p.id === provider.data)
    : undefined;
  if (!product) return <Redirect href="/earn" />;

  const position = product.position;
  const held = product.assets.filter((asset) => (asset.position ?? 0) > 0);

  return (
    <ScreenLayout>
      <View className="flex-row items-center gap-3">
        {product.icon && (
          <Image source={product.icon} className="h-9 w-9 rounded-xl" />
        )}
        <Typography variant="title2" weight="600">
          {product.provider}
        </Typography>
      </View>

      <ScrollView
        className="mt-6 flex-1"
        contentContainerClassName="pb-28"
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center gap-2">
          <Typography variant="body" className="text-foreground/40">
            Balance
          </Typography>
          <Typography variant="body" className="text-foreground/20">
            •
          </Typography>
          <Typography variant="body" weight="600" className="text-success">
            {apyLabel(product)}
          </Typography>
        </View>
        {position == null ? (
          <Typography variant="h3" weight="700">
            —
          </Typography>
        ) : (
          <BalanceView variant="h3" weight="700" amount={position.toFixed(2)} />
        )}

        <View className="mt-6 flex-row justify-between">
          <Stat label="Lifetime Earned" amount={product.lifetimeEarned} />
          <Stat label="Last 7D" amount={product.lastSevenDays} alignEnd />
        </View>

        {product.assets.length > 1 && held.length > 0 && (
          <View className="mt-8">
            <Typography variant="body" weight="600" className="mb-1">
              Your tokens
            </Typography>
            {held.map((asset) => (
              <HapticPressable
                key={asset.mint}
                accessibilityRole="button"
                accessibilityLabel={`${asset.name}, ${formatTokenAmount(asset.position ?? 0, asset.decimals)} ${asset.symbol}`}
                onPress={() =>
                  router.push({
                    pathname: "/token/[mint]",
                    params: { mint: asset.mint, earn: product.id },
                  })
                }
                className="flex-row items-center gap-3 py-2.5"
              >
                <TokenMark
                  mint={asset.mint}
                  label={asset.symbol}
                  iconUrl={asset.iconUrl}
                  size={40}
                />
                <View className="flex-1">
                  <Typography variant="body" weight="600">
                    {asset.name}
                  </Typography>
                  <Typography variant="body" className="text-foreground/40">
                    {formatTokenAmount(asset.position ?? 0, asset.decimals)}{" "}
                    {asset.symbol}
                  </Typography>
                </View>
                <View className="items-end">
                  <Typography variant="body" weight="600">
                    {asset.positionUsd === null
                      ? "Unpriced"
                      : formatEarnMoney(asset.positionUsd)}
                  </Typography>
                  <Typography variant="caption" className="text-success">
                    {asset.apyDisplay} APY
                  </Typography>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={palette.fg(0.3)}
                />
              </HapticPressable>
            ))}
          </View>
        )}

        <View className="mt-8 rounded-[24px] border border-foreground/5 bg-foreground/[0.01] p-5">
          <View className="mb-4 flex-row items-baseline justify-between gap-2">
            <Typography variant="body" weight="600">
              {RANGE_TITLES[range]}
            </Typography>
            {!history.isError && !history.isPending && (
              <Typography variant="body" weight="600">
                {chart.earnedInRange > 0 && chart.earnedInRange < 0.01
                  ? "Under $0.01"
                  : formatEarnMoney(chart.earnedInRange)}
              </Typography>
            )}
          </View>
          {history.isError ? (
            <View className="h-[108px] items-center justify-center gap-3">
              <Typography variant="body" className="text-foreground/50">
                Earnings could not be loaded.
              </Typography>
              <HapticPressable
                accessibilityRole="button"
                onPress={() => {
                  void history.refetch();
                }}
                className="rounded-full bg-foreground/5 px-4 py-2"
              >
                <Typography variant="body" weight="600">
                  Try again
                </Typography>
              </HapticPressable>
            </View>
          ) : (
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel={`${RANGE_TITLES[range]}: ${formatEarnMoney(chart.earnedInRange)}`}
            >
              <EarnBarChart
                values={chart.bars.map((bar) =>
                  history.isPending ? 0 : bar.earned
                )}
              />
              <View className="mt-2 flex-row justify-between">
                <Typography variant="caption" className="text-foreground/35">
                  {shortDate(chart.bars[0].label, range)}
                </Typography>
                <Typography variant="caption" className="text-foreground/35">
                  Today
                </Typography>
              </View>
            </View>
          )}
        </View>
        {!history.isError &&
          !history.isPending &&
          chart.earnedInRange === 0 && (
            <Typography
              variant="caption"
              className="mt-3 text-center text-foreground/40"
            >
              Your first cent of interest shows up here.
            </Typography>
          )}

        <View
          className={cn(
            "mt-6 flex-row items-center justify-center gap-2",
            history.isError && "opacity-40"
          )}
        >
          {RANGES.map((option) => {
            const active = option.id === range;
            return (
              <HapticPressable
                key={option.id}
                accessibilityRole="button"
                accessibilityLabel={`Show ${option.label} earnings`}
                accessibilityState={{
                  selected: active,
                  disabled: history.isError,
                }}
                disabled={history.isError}
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

        <Typography variant="title2" weight="600" className="mb-2 mt-10">
          About
        </Typography>
        <Typography variant="body" className="leading-5 text-foreground/60">
          {product.about}
        </Typography>
        <Typography
          variant="body"
          className="mt-4 leading-5 text-foreground/60"
        >
          Money in Earn carries protocol and smart contract risk, and could be
          lost.
        </Typography>
        <HapticPressable
          accessibilityRole="link"
          onPress={() => {
            void Linking.openURL(product.learnMoreUrl);
          }}
          className="mt-4 flex-row items-center gap-2 self-start"
        >
          <Ionicons name="globe" size={16} color={palette.foreground} />
          <Typography variant="body" weight="600">
            Learn more about {product.provider}
          </Typography>
        </HapticPressable>
      </ScrollView>

      <EarnActionBar
        hidden={!!flow}
        canWithdraw={(withdrawableBalances[product.id] ?? 0) > 0}
        onDeposit={() => setFlow({ step: "deposit", productId: product.id })}
        onWithdraw={() => setFlow({ step: "withdraw", productId: product.id })}
      />

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
            ? balance !== null
            : SEED_DEMO
              ? !balances.isLoading && !balances.isError
              : depositableMinor !== null
        }
        depositsEnabled={depositsEnabled}
        onChange={setFlow}
      />
    </ScreenLayout>
  );
}

function Stat({
  label,
  amount,
  alignEnd,
}: {
  label: string;
  amount: string | undefined;
  alignEnd?: boolean;
}) {
  return (
    <View className={cn("gap-1", alignEnd && "items-end")}>
      <Typography variant="body" className="text-foreground/40">
        {label}
      </Typography>
      {amount === undefined || amount === "—" ? (
        <Typography variant="title2" className="text-foreground/30">
          Unavailable
        </Typography>
      ) : (
        <Typography variant="title2" weight="600">
          {formatEarnMoney(Number(amount))}
        </Typography>
      )}
    </View>
  );
}
