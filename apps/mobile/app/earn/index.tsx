import React, { useState } from "react";
import { Image, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useFeature } from "@/hooks/useFeature";
import { usePalette } from "@/hooks/usePalette";
import { earnDepositLimit } from "@/utils/earn";
import { SEED_DEMO } from "@/utils/devSeed";
import { cn } from "@/utils/cn";
import BalanceView from "@/components/BalanceView";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { GlassButton, GlassSurface } from "@/components/ui/atoms/Glass";
import { Typography } from "@/components/ui/atoms/Typography";
import { ScreenLayout } from "@/components/ui/layout";
import { useEarnProducts, useEarnPosition } from "@/hooks/useEarn";

import { EarnFlow, type EarnFlowState } from "@/components/earn/EarnFlow";
import { useBalances } from "@/hooks/useBalances";

/** Vault-owned lending positions and the reference deposit/discovery flow. */
export default function EarnScreen() {
  const router = useRouter();
  const palette = usePalette();
  const depositsEnabled = useFeature("earnDeposits");
  const [flow, setFlow] = useState<EarnFlowState | null>(null);
  const { products } = useEarnProducts();
  const balances = useBalances();
  const {
    balance,
    depositableMinor,
    hasExternalReceipts,
    withdrawableBalances,
    balanceDisplay,
    apyDisplay,
    lifetimeEarned,
    lastSevenDays,
  } = useEarnPosition();

  return (
    <ScreenLayout>
      <View className="flex-row items-center gap-3">
        <Image
          source={require("@/assets/icons/earn.png")}
          className="h-9 w-9 rounded-xl"
        />
        <Typography variant="title2" weight="600">
          Earn
        </Typography>
      </View>

      <View className="mt-6">
        <View className="flex-row items-center gap-2">
          <Typography variant="body" className="text-foreground/40">
            Balance
          </Typography>
          <Typography variant="body" className="text-foreground/20">
            •
          </Typography>
          <Typography variant="body" className="text-foreground/40">
            APY {apyDisplay}
          </Typography>
        </View>
        {balanceDisplay === "—" ? (
          <Typography variant="h3" weight="700">
            —
          </Typography>
        ) : (
          <BalanceView variant="h3" weight="700" amount={balanceDisplay} />
        )}
      </View>

      <View className="mt-6 flex-row gap-3">
        <StatCard
          icon="sparkles"
          label="Lifetime Earned"
          amount={lifetimeEarned}
        />
        <StatCard icon="calendar" label="Last 7D" amount={lastSevenDays} />
      </View>

      <View className="mb-3 mt-8 flex-row items-baseline justify-between">
        <Typography variant="body" weight="600">
          Available products
        </Typography>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3 pb-28"
        showsVerticalScrollIndicator={false}
      >
        {products.map((product) => (
          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel={`About ${product.provider} ${product.name}`}
            onPress={() => setFlow({ step: "info", productId: product.id })}
            key={product.id}
            className="rounded-2xl bg-foreground/[0.03] px-4 py-4"
          >
            <View className="flex-row items-center gap-3">
              <View
                className={cn(
                  "h-11 w-11 items-center justify-center overflow-hidden rounded-2xl",
                  !product.icon && "bg-primary/80"
                )}
              >
                {product.icon ? (
                  <Image source={product.icon} className="h-11 w-11" />
                ) : (
                  <Typography
                    variant="body"
                    weight="700"
                    className="text-primary-foreground"
                  >
                    {product.provider.slice(0, 1)}
                  </Typography>
                )}
              </View>
              <View className="flex-1">
                <View className="flex-row items-center gap-1">
                  <Typography variant="body" className="text-foreground/40">
                    {product.provider}
                  </Typography>
                  <Typography variant="body" className="text-foreground/20">
                    •
                  </Typography>
                  <Typography
                    variant="body"
                    weight="600"
                    className="text-success"
                  >
                    {product.apy === null
                      ? "Rate unavailable"
                      : `${product.apyDisplay} ${product.simulated ? "Simulated APY" : "APY"}`}
                  </Typography>
                </View>
                <Typography variant="title2" weight="600">
                  {product.name}
                </Typography>
              </View>
            </View>
            <Typography variant="body" className="mt-3 text-foreground/40">
              {product.description}
            </Typography>
          </HapticPressable>
        ))}
      </ScrollView>

      <View className="absolute bottom-2 left-5 right-5 flex-row items-center gap-3">
        <GlassButton
          radius={999}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          className="h-14 w-14 items-center justify-center rounded-full"
        >
          <Ionicons name="chevron-back" size={22} color={palette.foreground} />
        </GlassButton>

        <GlassSurface
          radius={999}
          className="ml-auto flex-row items-center gap-6 rounded-full px-6 py-4"
        >
          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel="Deposit into Earn"
            onPress={() => setFlow({ step: "choose" })}
            className="flex-row items-center gap-2"
          >
            <Ionicons name="add" size={18} color={palette.foreground} />
            <Typography variant="body" weight="600">
              Deposit
            </Typography>
          </HapticPressable>

          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel="Withdraw from Earn"
            // Disabled rather than hidden: a zero position should still show
            // the Consumer that withdrawing is how they get out.
            disabled={
              balance === null ||
              !Object.values(withdrawableBalances).some((value) => value > 0)
            }
            accessibilityState={{
              disabled:
                balance === null ||
                !Object.values(withdrawableBalances).some((value) => value > 0),
            }}
            onPress={() => setFlow({ step: "choose-withdraw" })}
            className={cn(
              "flex-row items-center gap-2",
              (balance === null ||
                !Object.values(withdrawableBalances).some(
                  (value) => value > 0
                )) &&
                "opacity-30"
            )}
          >
            <Ionicons name="arrow-up" size={18} color={palette.foreground} />
            <Typography variant="body" weight="600">
              Withdraw
            </Typography>
          </HapticPressable>
        </GlassSurface>
      </View>

      {hasExternalReceipts && (
        <Typography variant="caption" className="mb-3 text-foreground/40">
          Some of your balance is not available to withdraw in the app yet.
        </Typography>
      )}

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

function StatCard({
  icon,
  label,
  amount,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  amount: string;
}) {
  const palette = usePalette();
  return (
    <View className="flex-1 gap-6 rounded-2xl bg-foreground/[0.03] px-4 py-4">
      <View className="flex-row items-center gap-2">
        <Ionicons name={icon} size={15} color={palette.fg(0.75)} />
        <Typography variant="body" weight="600">
          {label}
        </Typography>
      </View>
      {amount === "—" ? (
        <Typography variant="title2" weight="600">
          —
        </Typography>
      ) : (
        <BalanceView variant="title2" weight="600" amount={amount} />
      )}
    </View>
  );
}
