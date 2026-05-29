import React from "react";
import { View, Pressable } from "react-native";
import { ThemedText, AppIcon } from "@/components/ui/atoms";
import { cn } from "@/utils/cn";
import type { Transaction } from "@/types/Transaction";

interface TransactionItemProps {
  item: Transaction;
  isLast?: boolean;
  onPress?: () => void;
}

export function TransactionItem({ item, onPress }: TransactionItemProps) {
  const { type, amount, status, timestamp, from, to } = item;
  const iconName = type === "sent" ? "sent" : "money-added";
  const prefix = type === "sent" ? "To: " : "From: ";
  const counterparty = type === "sent" ? to : from;
  const truncated = counterparty ? counterparty.substring(0, 5) : "";
  const dateLabel = new Date(timestamp).toLocaleDateString();
  const amountNum = parseFloat(amount);
  const isPending = status === "PENDING";

  return (
    <Pressable
      className="flex-row items-center bg-transparent p-4"
      onPress={onPress}
    >
      <AppIcon name={iconName} size={34} />
      <View className="ml-2.5 h-[34px] flex-1 flex-col justify-between pt-0.5">
        <ThemedText type="regular">
          {type}
          {isPending && (
            <ThemedText type="tiny" className="opacity-50">
              {" "}
              · Pending
            </ThemedText>
          )}
        </ThemedText>
        <View className="flex-row items-center">
          <ThemedText type="tiny">{prefix + truncated}</ThemedText>
          <ThemedText type="tiny" className="opacity-60">
            {" "}
            • {dateLabel}
          </ThemedText>
        </View>
      </View>

      <ThemedText
        type="defaultSemiBold"
        className={cn(
          "text-right",
          type === "sent" ? "text-foreground" : "text-success",
        )}
      >
        {type === "sent" ? "-" : "+"}${Math.abs(amountNum).toFixed(2)}
      </ThemedText>
    </Pressable>
  );
}
