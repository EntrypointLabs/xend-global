import React from "react";
import { Image, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import BalanceView from "@/components/BalanceView";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { ScreenLayout } from "@/components/ui/layout";
import { useInvestments, type InvestmentHolding } from "@/hooks/useInvestments";

/**
 * Investments: every token the Consumer holds that is not their spending
 * balance. Nothing to opt into, so the screen is a read of what they already
 * own rather than a product surface.
 */
export default function InvestmentsScreen() {
  const router = useRouter();
  const { holdings, isEmpty, isError } = useInvestments();

  // Priced holdings are a later evolution; until then the headline is the count
  // of assets rather than a dollar figure we would have to invent.
  const total = isError ? "0.00" : holdings.length > 0 ? "" : "0.00";

  return (
    <ScreenLayout>
      <View className="flex-row items-center gap-3">
        <Image
          source={require("@/assets/icons/investment.png")}
          className="h-10 w-10 rounded-xl"
        />
        <Typography variant="h5" weight="600">
          Investments
        </Typography>
      </View>

      <View className="mt-6">
        <Typography variant="body" className="text-black/40">
          {holdings.length > 0
            ? `${holdings.length} asset${holdings.length === 1 ? "" : "s"}`
            : "Balance"}
        </Typography>
        {total !== "" && (
          <BalanceView variant="h2" weight="700" amount={total} />
        )}
      </View>

      {isEmpty ? (
        <EmptyState onGetAssets={() => router.push("/cash")} />
      ) : (
        <ScrollView
          className="mt-6 flex-1"
          contentContainerClassName="gap-3 pb-6"
          showsVerticalScrollIndicator={false}
        >
          {holdings.map((holding) => (
            <HoldingRow key={holding.mint} holding={holding} />
          ))}
        </ScrollView>
      )}

      <View className="absolute bottom-6 left-5">
        <HapticPressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          className="h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm"
        >
          <Ionicons name="chevron-back" size={22} color="#000" />
        </HapticPressable>
      </View>
    </ScreenLayout>
  );
}

function EmptyState({ onGetAssets }: { onGetAssets: () => void }) {
  return (
    <View className="flex-1 items-center justify-center gap-2">
      <View className="mb-4 h-16 w-28 flex-row items-center gap-2 rounded-2xl border-2 border-dashed border-black/10 px-4">
        <View className="h-7 w-7 rounded-full bg-black/5" />
        <View className="gap-1">
          <View className="h-2 w-10 rounded-full bg-black/5" />
          <View className="h-2 w-6 rounded-full bg-black/5" />
        </View>
      </View>

      <Typography variant="title1" weight="600">
        There is nothing here yet
      </Typography>
      <Typography variant="body" className="text-black/40">
        Deposit or swap tokens
      </Typography>

      <HapticPressable
        accessibilityRole="button"
        accessibilityLabel="Get assets"
        onPress={onGetAssets}
        className="mt-5 flex-row items-center gap-2 rounded-full bg-black px-6 py-4"
      >
        <Ionicons name="arrow-down-circle" size={18} color="#fff" />
        <Typography variant="title2" weight="600" className="text-white">
          Get Assets
        </Typography>
      </HapticPressable>
    </View>
  );
}

function HoldingRow({ holding }: { holding: InvestmentHolding }) {
  const label =
    holding.symbol ?? `${holding.mint.slice(0, 4)}…${holding.mint.slice(-4)}`;

  return (
    <View className="flex-row items-center justify-between rounded-2xl border border-black/5 px-4 py-4">
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-black/5">
          <Typography variant="body" weight="600">
            {label.slice(0, 2).toUpperCase()}
          </Typography>
        </View>
        <Typography variant="title2" weight="600">
          {label}
        </Typography>
      </View>
      <Typography variant="title2" weight="600">
        {holding.amount.toLocaleString("en-US", {
          maximumFractionDigits: 4,
        })}
      </Typography>
    </View>
  );
}
