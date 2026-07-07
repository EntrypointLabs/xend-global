import React from "react";
import { View, Image, TouchableOpacity } from "react-native";
import { ActionModal } from "../ActionModal";
import { iconForMint } from "../ActivityItem";
import { FontAwesome6, Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { notificationAsync, NotificationFeedbackType } from "expo-haptics";
import { formatAmount } from "@/utils/solana";
import { truncateAddress } from "@/utils/helper";
import { cn } from "@/utils/cn";
import { Typography } from "../../atoms/Typography";
import { format } from "date-fns";
import HapticPressable from "../../atoms/HapticPressable";
import { useContacts } from "@/hooks/useContacts";
import { statusLabel, type ActivityEntry } from "@/utils/activity";

interface TransactionDetailModalProps {
  visible: boolean;
  onClose: () => void;
  item: ActivityEntry | null;
}

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const STATUS_META: Record<
  ActivityEntry["status"],
  { label: string; color: string; icon: IoniconName; textClass: string }
> = {
  confirmed: {
    label: "Completed",
    color: "#34C759",
    icon: "checkmark-circle",
    textClass: "text-success",
  },
  pending: {
    label: "Pending",
    color: "#FF9500",
    icon: "time",
    textClass: "text-[#FF9500]",
  },
  failed: {
    label: "Failed",
    color: "#FF3B30",
    icon: "close-circle",
    textClass: "text-destructive",
  },
};

const USDC_MINT = process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS;

export function TransactionDetailModal({
  visible,
  onClose,
  item,
}: TransactionDetailModalProps) {
  const { contacts } = useContacts();
  const copyIconColor = "rgba(0,0,0,0.3)";

  if (!item) return null;

  const copyToClipboard = async (text: string) => {
    await Clipboard.setStringAsync(text);
    notificationAsync(NotificationFeedbackType.Success);
  };

  const status = STATUS_META[item.status];
  const amount = formatAmount(item.amountRaw, item.decimals);
  const symbol = USDC_MINT && item.mint === USDC_MINT ? "USDC" : "";
  const date = format(new Date(item.createdAt), "MMM d, yyyy 'at' h:mma");
  const signature = item.signature;

  const counterpartyLabel = item.direction === "send" ? "To" : "From";
  const contact = contacts.find((c) => c.address === item.counterparty);
  const counterpartyDisplay =
    contact?.name ?? truncateAddress(item.counterparty);

  const rowClass = "flex-row justify-between items-center py-2";
  return (
    <ActionModal visible={visible} onClose={onClose}>
      <View className="items-center">
        <HapticPressable
          onPress={onClose}
          className="absolute -right-4 -top-4 p-4"
        >
          <FontAwesome6 name="xmark" size={20} color={copyIconColor} />
        </HapticPressable>

        <View className="relative mb-3">
          <Image
            source={iconForMint(item.mint)}
            className="h-16 w-16 rounded-full"
          />
          <View className="absolute right-0 top-0 overflow-hidden rounded-full bg-white">
            <Ionicons name={status.icon} size={16} color={status.color} />
          </View>
        </View>

        <Typography weight="600" className="mb-1 text-sm text-black/30">
          {statusLabel(item)}
        </Typography>

        <Typography weight="700" className="mb-1 text-3xl">
          {amount}
          {symbol ? ` ${symbol}` : ""}
        </Typography>

        <Typography weight="600" className="mb-4 text-sm text-black/30">
          {date}
        </Typography>

        <View className="w-full pb-3">
          <View className={rowClass}>
            <Typography weight="600">Status</Typography>
            <View className="flex-row items-center">
              <Typography className={cn("mr-1", status.textClass)}>
                {status.label}
              </Typography>
              <Ionicons name={status.icon} size={14} color={status.color} />
            </View>
          </View>

          <View className={rowClass}>
            <Typography weight="600" className="text-black/30">
              {counterpartyLabel}
            </Typography>
            <TouchableOpacity
              className="flex-row items-center"
              onPress={() => copyToClipboard(item.counterparty)}
            >
              <Typography weight="600" className="mr-1">
                {counterpartyDisplay}
              </Typography>
              <Ionicons name="copy-outline" size={14} color={copyIconColor} />
            </TouchableOpacity>
          </View>

          <View className={rowClass}>
            <Typography weight="600" className="text-black/30">
              Onchain transaction
            </Typography>
            {signature ? (
              <TouchableOpacity
                className="flex-row items-center"
                onPress={() => copyToClipboard(signature)}
              >
                <Typography weight="600" className="mr-1">
                  {truncateAddress(signature)}
                </Typography>
                <Ionicons name="copy-outline" size={14} color={copyIconColor} />
              </TouchableOpacity>
            ) : (
              <Typography weight="600" className="text-black/30">
                Pending
              </Typography>
            )}
          </View>

          <View className={rowClass}>
            <Typography weight="600" className="text-black/30">
              Onchain fees
            </Typography>
            <View className="flex-row items-center">
              <Typography
                weight="500"
                className="mr-1 text-[13px] text-black/30"
              >
                Xend⁺
              </Typography>
              <Typography weight="500" className="text-success">
                Covered
              </Typography>
            </View>
          </View>
        </View>
      </View>
    </ActionModal>
  );
}
