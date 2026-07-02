import React from "react";
import { View, Pressable } from "react-native";
import { ThemedText, AppIcon } from "@/components/ui/atoms";
import { cn } from "@/utils/cn";
import type { ActivityEntry } from "@/utils/activity";
import { statusLabel } from "@/utils/activity";
import { truncateAddress } from "@/utils/helper";
import { formatAmount } from "@/utils/solana";

const USDC_MINT = process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS;

export type TransactionItemProps = ActivityEntry & {
  isLast?: boolean;
  onPress?: () => void;
};

export function TransactionItem({ onPress, ...entry }: TransactionItemProps) {
  const isSend = entry.direction === "send";
  const isInactive = entry.status === "pending" || entry.status === "failed";

  const iconName = isSend ? "sent" : "money-added";
  const prefix = isSend ? "To: " : "From: ";
  const amount = formatAmount(entry.amountRaw, entry.decimals);
  const symbol = USDC_MINT && entry.mint === USDC_MINT ? "USDC" : "";
  const sign = isSend ? "-" : "+";

  const valueColorClass = isInactive
    ? "text-foreground/30"
    : isSend
      ? "text-foreground"
      : "text-success";

  return (
    <Pressable
      className="flex-row items-center bg-transparent p-4"
      onPress={onPress}
    >
      <AppIcon name={iconName} size={34} />
      <View className="ml-2.5 h-[34px] flex-1 flex-col justify-between pt-0.5">
        <ThemedText type="regular">{statusLabel(entry)}</ThemedText>
        <ThemedText type="tiny">
          {prefix}
          {truncateAddress(entry.counterparty)}
        </ThemedText>
      </View>

      <ThemedText
        type="defaultSemiBold"
        className={cn(
          "text-right",
          valueColorClass,
          entry.status === "failed" && "line-through"
        )}
      >
        {sign}
        {amount}
        {symbol ? ` ${symbol}` : ""}
      </ThemedText>
    </Pressable>
  );
}
