import React from "react";
import { Image, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import BalanceView from "@/components/BalanceView";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { ScreenLayout } from "@/components/ui/layout";
import { EARN_PRODUCTS, useEarnPosition } from "@/hooks/useEarn";

/**
 * Earn: yield on the Consumer's spending balance.
 *
 * Deposits are not wired yet, so the screen shows a real zero position and the
 * products actually on offer rather than a "coming soon" wall. The numbers are
 * the Consumer's own, so they stay honest as soon as deposits land.
 */
export default function EarnScreen() {
  const router = useRouter();
  const { balanceDisplay, apyDisplay, lifetimeEarned, lastSevenDays } =
    useEarnPosition();

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
          <Typography variant="body" className="text-black/40">
            Balance
          </Typography>
          <Typography variant="body" className="text-black/20">
            •
          </Typography>
          <Typography variant="body" className="text-black/40">
            APY {apyDisplay}
          </Typography>
        </View>
        <BalanceView variant="h3" weight="700" amount={balanceDisplay} />
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
        {/* Stated inline rather than as a toast: the global toast renders in the
            header band and collides with the screen title. */}
        <Typography variant="caption" className="text-black/40">
          Deposits open soon
        </Typography>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3 pb-28"
        showsVerticalScrollIndicator={false}
      >
        {EARN_PRODUCTS.map((product) => (
          <View
            key={product.id}
            className="rounded-2xl bg-black/[0.03] px-4 py-4"
          >
            <View className="flex-row items-center gap-3">
              <View className="h-11 w-11 items-center justify-center rounded-2xl bg-black/80">
                <Typography variant="body" weight="700" className="text-white">
                  {product.provider.slice(0, 1)}
                </Typography>
              </View>
              <View className="flex-1">
                <View className="flex-row items-center gap-1">
                  <Typography variant="body" className="text-black/40">
                    {product.provider}
                  </Typography>
                  <Typography variant="body" className="text-black/20">
                    •
                  </Typography>
                  <Typography
                    variant="body"
                    weight="600"
                    className="text-success"
                  >
                    {product.apyDisplay} APY
                  </Typography>
                </View>
                <Typography variant="title2" weight="600">
                  {product.name}
                </Typography>
              </View>
            </View>
            <Typography variant="body" className="mt-3 text-black/40">
              {product.description}
            </Typography>
          </View>
        ))}
      </ScrollView>

      <View className="absolute bottom-2 left-5 right-5 flex-row items-center gap-3">
        <HapticPressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          className="h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm"
        >
          <Ionicons name="chevron-back" size={22} color="#000" />
        </HapticPressable>

        <View className="ml-auto flex-row items-center gap-6 rounded-full bg-white px-6 py-4 shadow-sm">
          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel="Deposit into Earn"
            // Both actions are muted because neither is wired yet. They stay
            // visible so the shape of the product is legible.
            disabled
            onPress={() => {}}
            className="flex-row items-center gap-2 opacity-30"
          >
            <Ionicons name="add" size={18} color="#000" />
            <Typography variant="body" weight="600">
              Deposit
            </Typography>
          </HapticPressable>

          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel="Withdraw from Earn"
            // Disabled rather than hidden: a zero position should still show
            // the Consumer that withdrawing is how they get out.
            disabled
            onPress={() => {}}
            className="flex-row items-center gap-2 opacity-30"
          >
            <Ionicons name="arrow-up" size={18} color="#000" />
            <Typography variant="body" weight="600">
              Withdraw
            </Typography>
          </HapticPressable>
        </View>
      </View>
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
  return (
    <View className="flex-1 gap-6 rounded-2xl bg-black/[0.03] px-4 py-4">
      <View className="flex-row items-center gap-2">
        <Ionicons name={icon} size={15} color="rgba(0,0,0,0.75)" />
        <Typography variant="body" weight="600">
          {label}
        </Typography>
      </View>
      <BalanceView variant="title2" weight="600" amount={amount} />
    </View>
  );
}
