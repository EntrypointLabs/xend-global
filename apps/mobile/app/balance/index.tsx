import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import BalanceView from "@/components/BalanceView";
import { GlassButton } from "@/components/ui/atoms/Glass";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";
import { Typography } from "@/components/ui/atoms/Typography";
import { ScreenLayout } from "@/components/ui/layout";
import { BalanceBuckets } from "@/components/ui/organisms/home/BalanceBuckets";
import { useBalanceBuckets } from "@/hooks/useBalanceBuckets";
import { useBalances } from "@/hooks/useBalances";
import { useEarnPosition } from "@/hooks/useEarn";
import { formatMoney } from "@/utils/balances";

/** What the total balance is made of, and the way into each part. */
export default function BalanceScreen() {
  const router = useRouter();
  const { portfolio, isError, refetch } = useBalances();
  const { balance: earnBalance } = useEarnPosition();
  const buckets = useBalanceBuckets();
  const total = portfolio.cashUsd + portfolio.investmentsUsd + earnBalance;

  return (
    <ScreenLayout>
      <TabHeaderText className="pb-6">Total Balance</TabHeaderText>

      {isError ? (
        <HapticPressable
          className="flex-row items-center gap-1.5 self-start"
          onPress={() => refetch()}
        >
          <Typography weight="700" variant="h2">
            ——
          </Typography>
          <View className="flex-row items-center gap-1 rounded-full bg-black/5 px-2.5 py-1">
            <Ionicons name="refresh" size={14} color="#999" />
            <Typography weight="500" className="text-sm text-black/40">
              Couldn&apos;t load. Tap to retry
            </Typography>
          </View>
        </HapticPressable>
      ) : (
        <BalanceView weight="700" variant="h2" amount={formatMoney(total)} />
      )}

      <View className="mt-8">
        <BalanceBuckets buckets={buckets} />
      </View>

      <View className="absolute bottom-2 left-5">
        <GlassButton
          radius={999}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          className="h-14 w-14 items-center justify-center rounded-full"
        >
          <Ionicons name="chevron-back" size={22} color="#000" />
        </GlassButton>
      </View>
    </ScreenLayout>
  );
}
