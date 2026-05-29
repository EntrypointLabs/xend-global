import React, { useState } from "react";
import { View, TouchableOpacity } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import { ThemedScreen } from "@/components/ui/layout";
import { Keypad } from "@/components/ui/molecules";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { formatAmount } from "@/utils/helper";
import { useBalancesQuery } from "@/queries/useBalancesQuery";
import { cn } from "@/utils/cn";

export default function AmountScreen() {
  const [amount, setAmount] = useState("0");
  const { recipient } = useLocalSearchParams<{ recipient: string }>();
  const balance = useBalancesQuery().data?.usdc ?? 0;

  const handleKeyPress = (key: string) => {
    if (key === "backspace") {
      setAmount((prev) => (prev.length > 1 ? prev.slice(0, -1) : "0"));
    } else if (key === ".") {
      if (!amount.includes(".")) setAmount((prev) => prev + ".");
    } else {
      if (amount === "0") setAmount(key);
      else {
        const parts = amount.split(".");
        if (parts.length > 1 && parts[1].length >= 2) return;
        setAmount((prev) => prev + key);
      }
    }
  };

  const handleContinue = () => {
    // Navigate to Confirm Screen (implementation TBD for next step, using console for now or existing confirm)
    router.push({
      pathname: "/confirm",
      params: {
        amount,
        recipient,
        type: "wallet",
        title: "Confirm Transaction",
      },
    });
  };

  return (
    <ThemedScreen useSafeArea={true} safeAreaEdges={["top", "bottom"]}>
      <View className="relative flex-1 bg-white px-4 pt-2">
        {/* Header */}
        <View className="mb-4 flex-row items-center justify-between">
          <TouchableOpacity
            onPress={() => router.back()}
            className="h-10 w-10 items-center justify-center rounded-full bg-gray-100"
          >
            <Ionicons name="chevron-back" size={24} color="#999" />
          </TouchableOpacity>
          <View className="items-center">
            <Typography weight="700" className="text-lg">
              Enter amount
            </Typography>
            <Typography className="text-sm text-gray-400">
              To: {recipient?.slice(0, 4)}...{recipient?.slice(-4)}
            </Typography>
          </View>
          <View className="h-10 w-10" />
        </View>

        {/* Amount Display */}
        <View className="-mt-20 flex-1 items-center justify-center">
          <Typography
            weight="700"
            className="text-[64px] tracking-tight text-gray-300"
          >
            {amount === "0" ? "0" : formatAmount({ amount })}
          </Typography>
          <View className="mt-2 flex-row items-center">
            <Typography weight="500" className="mr-1 text-lg text-gray-400">
              $0
            </Typography>
          </View>

          {/* Swap Icon Button */}
          <TouchableOpacity className="absolute right-0 top-1/2 mt-4 h-10 w-10 items-center justify-center rounded-full border border-gray-100 bg-white shadow-sm">
            <Ionicons name="swap-vertical" size={20} color="black" />
          </TouchableOpacity>
        </View>

        {/* Token Selector & Max */}
        <View className="mx-6 mb-8 flex-row items-center justify-between rounded-full bg-[#F9F9F9] p-2">
          <TouchableOpacity className="flex-row items-center rounded-full bg-white px-3 py-1.5 shadow-sm">
            <View className="mr-2 h-5 w-5 items-center justify-center rounded-full bg-blue-500">
              <Ionicons name="logo-usd" size={12} color="white" />
            </View>
            <Typography weight="700" className="mr-1">
              USDC
            </Typography>
            <Ionicons name="chevron-down" size={12} color="black" />
          </TouchableOpacity>

          <Typography weight="500" className="ml-3 flex-1 text-gray-400">
            {balance ? balance.toFixed(2) : "0.00"} USDC
          </Typography>

          <TouchableOpacity
            className="rounded-full bg-black px-4 py-1.5"
            onPress={() => setAmount(balance.toString())}
          >
            <Typography weight="700" className="text-xs text-white">
              MAX
            </Typography>
          </TouchableOpacity>
        </View>

        {/* Keypad */}
        <View className="mb-6">
          <Keypad onKeyPress={handleKeyPress} />
        </View>

        {/* Review Button */}
        <TouchableOpacity
          className={cn(
            "mb-6 w-full items-center rounded-full py-4",
            Number(amount) > 0 ? "bg-gray-500" : "bg-gray-300"
          )}
          onPress={handleContinue}
          disabled={Number(amount) <= 0}
        >
          <Typography weight="700" className="text-lg text-white">
            Review
          </Typography>
        </TouchableOpacity>
      </View>
    </ThemedScreen>
  );
}
