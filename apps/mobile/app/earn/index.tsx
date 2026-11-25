import React, { useState } from "react";
import { Image, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useFeature } from "@/hooks/useFeature";
import { usePalette } from "@/hooks/usePalette";
import { earnDepositLimit } from "@/utils/earn";
import { SEED_DEMO } from "@/utils/devSeed";
import BalanceView from "@/components/BalanceView";
import { Typography } from "@/components/ui/atoms/Typography";
import { ScreenLayout } from "@/components/ui/layout";
import { useEarnProducts, useEarnPosition } from "@/hooks/useEarn";

import { EarnActionBar } from "@/components/earn/EarnActionBar";
import { EarnFlow, type EarnFlowState } from "@/components/earn/EarnFlow";
import { PositionRow, ProductCard } from "@/components/earn/EarnProductRows";
import { useBalances } from "@/hooks/useBalances";

/** Vault-owned lending positions and the reference deposit/discovery flow. */
export default function EarnScreen() {
  const router = useRouter();
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
  const held = products.filter((p) => (p.position ?? 0) >= 0.01);
  const earning = apyDisplay !== "—" && balance !== null && balance > 0;
  const others = products.filter((p) => !held.includes(p));

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
          <Typography
            variant="body"
            weight={earning ? "600" : undefined}
            className={earning ? "text-success" : "text-foreground/40"}
          >
            {apyDisplay === "—" ? "APY unavailable" : `${apyDisplay} APY`}
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

      <ScrollView
        className="mt-8 flex-1"
        contentContainerClassName="pb-28"
        showsVerticalScrollIndicator={false}
      >
        {held.length > 0 && (
          <>
            <SectionTitle>Current positions</SectionTitle>
            <View className="mb-8 gap-2">
              {held.map((product) => (
                <PositionRow
                  key={product.id}
                  product={product}
                  onPress={() => router.push(`/earn/${product.id}`)}
                />
              ))}
            </View>
          </>
        )}
        {others.length > 0 && (
          <>
            <SectionTitle>
              {held.length > 0 ? "Other products" : "Available products"}
            </SectionTitle>
            <View className="gap-3">
              {others.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onPress={() =>
                    setFlow({ step: "info", productId: product.id })
                  }
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <EarnActionBar
        hidden={!!flow}
        canWithdraw={
          balance !== null &&
          Object.values(withdrawableBalances).some((value) => value > 0)
        }
        onDeposit={() => setFlow({ step: "choose" })}
        onWithdraw={() => {
          const withdrawable = products.filter(
            (p) => (withdrawableBalances[p.id] ?? 0) > 0
          );
          setFlow(
            withdrawable.length === 1
              ? { step: "withdraw", productId: withdrawable[0].id }
              : { step: "choose-withdraw" }
          );
        }}
      />

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

function SectionTitle({ children }: { children: string }) {
  return (
    <Typography variant="body" weight="600" className="mb-3">
      {children}
    </Typography>
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
        <Typography variant="title2" className="text-foreground/30">
          Unavailable
        </Typography>
      ) : (
        <BalanceView variant="title2" weight="600" amount={amount} />
      )}
    </View>
  );
}
