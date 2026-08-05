import { View, Image, ImageSourcePropType } from "react-native";
import { Typography } from "../atoms/Typography";
import type { ActivityEntry } from "@/utils/activity";
import { statusLabel } from "@/utils/activity";
import { truncateAddress } from "@/utils/helper";
import { formatAmount } from "@/utils/solana";
import HapticPressable from "../atoms/HapticPressable";
import { cn } from "@/utils/cn";

const USDC_ICON = require("@/assets/icons/usdc.png");
const GENERIC_ICON = require("@/assets/icons/wallet.png");
const USDC_MINT = process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS;

export function iconForMint(mint: string): ImageSourcePropType {
  return USDC_MINT && mint === USDC_MINT ? USDC_ICON : GENERIC_ICON;
}

export type ActivityItemProps = ActivityEntry & {
  onPress?: () => void;
};

export function ActivityItem({ onPress, ...entry }: ActivityItemProps) {
  const isSend = entry.direction === "send";
  const isPayment = entry.kind === "payment";
  const isInactive = entry.status === "pending" || entry.status === "failed";

  const amount = formatAmount(entry.amountRaw, entry.decimals);
  const symbol = USDC_MINT && entry.mint === USDC_MINT ? "USDC" : "";
  const sign = isSend ? "-" : "+";
  // A Payment renders as a debit titled with the merchant's display name —
  // never an address, no chain vocabulary. Payments arrive as SEND, so the
  // existing debit sign + text-destructive styling apply unchanged.
  const label = isPayment
    ? (entry.merchantName ?? "Merchant")
    : isSend
      ? `To: ${truncateAddress(entry.counterparty)}`
      : `From: ${truncateAddress(entry.counterparty)}`;

  const valueColorClass = isInactive
    ? "text-black/30"
    : isSend
      ? "text-destructive"
      : "text-success";

  return (
    <HapticPressable
      className="flex-row items-center gap-3.5 py-3"
      onPress={onPress}
    >
      <Image
        source={iconForMint(entry.mint)}
        className="size-10 rounded-full"
      />
      <View className="flex-1 flex-row items-center justify-between">
        <View className="flex-col">
          <Typography weight="600" className="mb-0.5">
            {statusLabel(entry)}
          </Typography>
          <Typography weight="500" className="text-sm text-black/30">
            {label}
          </Typography>
        </View>
        <Typography
          weight="600"
          className={cn(
            "text-sm tracking-[0.5px]",
            valueColorClass,
            entry.status === "failed" && "line-through"
          )}
        >
          {sign}
          {amount}
          {symbol ? ` ${symbol}` : ""}
        </Typography>
      </View>
    </HapticPressable>
  );
}
