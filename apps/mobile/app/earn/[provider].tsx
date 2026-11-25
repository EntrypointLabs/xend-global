import React, { useMemo, useState } from "react";
import { Image, Linking, ScrollView, View } from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import BalanceView from "@/components/BalanceView";
import { EarnActionBar } from "@/components/earn/EarnActionBar";
import { EarnFlow, type EarnFlowState } from "@/components/earn/EarnFlow";
import { apyLabel } from "@/components/earn/EarnProductRows";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
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

/** One Earn position: what it holds, what it has earned, and the protocol behind it. */
export default function EarnPositionScreen() {
  const params = useLocalSearchParams<{ provider: string }>();
  const provider = EarnProviderSchema.safeParse(params.provider);
  const palette = usePalette();
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
  const bars = useMemo(
    () => earnBars(history.data?.points ?? [], range, today),
    [history.data, range, today]
  );

  const product = provider.success
    ? products.find((p) => p.id === provider.data)
    : undefined;
  if (!product) return <Redirect href="/earn" />;

  const peak = Math.max(...bars.map((bar) => bar.earned));
  const position = product.position;

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
            {product.name}
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

        <View className="mt-10 h-44 justify-end">
          {peak > 0 ? (
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel={`Earned ${formatEarnMoney(
                bars.reduce((sum, bar) => sum + bar.earned, 0)
              )} in this period`}
              className="h-full flex-row items-end"
            >
              {bars.map((bar) => (
                <View
                  key={bar.label}
                  className="h-full flex-1 items-center justify-end px-px"
                >
                  <View
                    className={cn(
                      "rounded-full",
                      bar.earned > 0
                        ? "w-2/5 bg-success"
                        : "w-full bg-foreground/10"
                    )}
                    style={{
                      height:
                        bar.earned > 0 ? `${(bar.earned / peak) * 100}%` : 4,
                    }}
                  />
                </View>
              ))}
            </View>
          ) : history.isError ? (
            <View className="flex-1 items-center justify-center gap-3 px-8">
              <Typography
                variant="body"
                className="text-center text-foreground/50"
              >
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
            <>
              <View
                className={cn(
                  "flex-1 items-center justify-center gap-3 px-8",
                  history.isPending && "opacity-0"
                )}
              >
                <Ionicons
                  name="stats-chart"
                  size={22}
                  color={palette.fg(0.25)}
                />
                <Typography
                  variant="body"
                  className="text-center text-foreground/50"
                >
                  Earnings will show here once your balance has earned a cent.
                </Typography>
              </View>
              <View className="flex-row">
                {Array.from({ length: 7 }, (_, i) => (
                  <View
                    key={i}
                    className="mx-[3px] h-1.5 flex-1 rounded-full bg-foreground/10"
                  />
                ))}
              </View>
            </>
          )}
        </View>

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
