import React from "react";
import { View, Pressable } from "react-native";
import { ThemedText, AppIcon } from "@/components/ui/atoms";
import { cn } from "@/utils/cn";

interface TransactionItemProps {
  type: "sent" | "received" | "bridge";
  date: string;
  amount: number;
  isLast?: boolean;
  address: string;
  status: string;
  onPress?: () => void;
}

export function TransactionItem({
  type,
  date,
  amount,
  onPress,
  address,
}: TransactionItemProps) {
  const iconName = type === "sent" ? "sent" : "money-added";
  const prefix = type === "sent" ? "To: " : "From: ";
  const truncatedAddress = address ? address.substring(0, 5) : "";
  const formattedAddress = `${prefix}${truncatedAddress}`;

  return (
    <Pressable
      className="flex-row items-center bg-transparent p-4"
      onPress={onPress}
    >
      <AppIcon name={iconName} size={34} />
      <View className="ml-2.5 h-[34px] flex-1 flex-col justify-between pt-0.5">
        <ThemedText type="regular">{type}</ThemedText>
        <View className="flex-row items-center">
          <ThemedText type="tiny">{formattedAddress}</ThemedText>
          <ThemedText type="tiny" className="opacity-60">
            {" "}
            • {date}
          </ThemedText>
        </View>
      </View>

      <ThemedText
        type="defaultSemiBold"
        className={cn(
          "text-right",
          type === "sent" ? "text-foreground" : "text-success"
        )}
      >
        {type === "sent" ? "-" : "+"}${Math.abs(amount).toFixed(2)}
      </ThemedText>
    </Pressable>
  );
}
