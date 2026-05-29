import React, { useMemo, useState } from "react";
import { View, TouchableOpacity } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import { Keypad } from "@/components/ui/molecules";
import { Ionicons } from "@expo/vector-icons";
import { formatAmount, truncateAddress } from "@/utils/helper";
import { useBalancesQuery } from "@/queries/useBalancesQuery";
import { useRouter } from "expo-router";
import HapticPressable from "../../atoms/HapticPressable";
import { cn } from "@/utils/cn";

interface AmountStepProps {
  recipient: string;
  onBack: () => void;
  onClose: () => void;
}

export default function AmountStep({
  recipient,
  onBack,
  onClose,
}: AmountStepProps) {
  const router = useRouter(); // For final navigation to confirm

  const [amount, setAmount] = useState("");
  const balance = useBalancesQuery().data?.usdc ?? 0;

  const handleKeyPress = (key: string) => {
    if (key === "backspace") {
      setAmount((prev) => (prev.length > 1 ? prev.slice(0, -1) : ""));
    } else if (key === ".") {
      if (!amount) {
        setAmount("0.");
        return;
      }
      if (!amount.includes(".")) setAmount((prev) => prev + ".");
    } else {
      if (amount === "0") setAmount(key);
      else {
        const parts = amount.split(".");
        if (parts.length > 1 && parts[1].length >= 8) return;
        setAmount((prev) => prev + key);
      }
    }
  };

  const handleContinue = () => {
    onClose(); // Close the bottom sheet flow
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

  const { status, label } = useMemo(() => {
    let label = "Review";
    let status = "idle";
    if (amount && Number(amount) > Number(balance)) {
      label = "Insufficient balance";
      status = "error";
    }

    if (Number(amount) > 0 && Number(amount) <= Number(balance)) {
      label = "Review";
      status = "ready";
    }

    return { status, label };
  }, [balance, amount]);

  const formattedAmount = useMemo(() => {
    if (amount === "") return "0";
    // if (amount === '0.') return amount;
    if (amount.endsWith(".")) {
      const [int] = amount.split(".");
      return (
        formatAmount({
          amount: int,
          minimumFractionDigits: 0,
          maximumFractionDigits: 8,
        }) + "."
      );
    }
    return formatAmount({
      amount,
      minimumFractionDigits: 0,
      maximumFractionDigits: 8,
    });
  }, [amount]);

  return (
    <View className="flex-1 bg-[#F0F0F0]">
      <View className="relative mb-6 flex-1 px-4">
        {/* Header */}
        <View className="mb-4 flex-row items-center justify-between">
          <TouchableOpacity
            onPress={onBack}
            className="h-10 w-10 items-center justify-center rounded-full bg-gray-100"
          >
            <Ionicons name="chevron-back" size={24} color="#999" />
          </TouchableOpacity>
          <View className="items-center">
            <Typography weight="700" className="text-lg">
              Enter amount
            </Typography>
            <Typography className="text-sm text-gray-400">
              To: {truncateAddress(recipient)}
            </Typography>
          </View>
          <View className="h-10 w-10" />
        </View>

        {/* Amount Display */}
        <View className="-mt-10 flex-1 items-center justify-center">
          <Typography
            weight="700"
            className={cn(
              "text-7xl tracking-tight",
              !amount ? "text-gray-300" : "text-black"
            )}
          >
            {formattedAmount}
          </Typography>
          {/* <View className="flex-row items-center mt-2">
                        <Text className="text-gray-400 text-lg font-medium mr-1">$0</Text>
                    </View> */}

          {/* Swap Icon Button */}
          {/* <TouchableOpacity className="absolute right-0 top-1/2 mt-4 w-10 h-10 bg-white rounded-full items-center justify-center border border-gray-100 shadow-sm">
                        <Ionicons name="swap-vertical" size={20} color="black" />
                    </TouchableOpacity> */}
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
        <View className="mb-2">
          <Keypad onKeyPress={handleKeyPress} />
        </View>

        {/* Review Button */}
        <HapticPressable
          className={cn("mb-2 w-full items-center rounded-full bg-black py-4", {
            "opacity-70": status === "idle",
            "opacity-100": status === "ready",
            "bg-red-500/30": status === "error",
          })}
          onPress={handleContinue}
          disabled={status === "error" || status === "idle"}
        >
          <Typography
            weight="500"
            className={cn(
              "text-base text-white",
              status === "error" && "text-red-500"
            )}
          >
            {label}
          </Typography>
        </HapticPressable>
      </View>
    </View>
  );
}
