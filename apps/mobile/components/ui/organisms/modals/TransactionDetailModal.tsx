import React from "react";
import {
  View,
  Image,
  TouchableOpacity,
  Linking,
  type ImageSourcePropType,
} from "react-native";
import { ActionModal } from "../ActionModal";
import { FontAwesome6, Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { notificationAsync, NotificationFeedbackType } from "expo-haptics";
import { truncateAddress } from "@/utils/helper";
import { Typography } from "../../atoms/Typography";
import { format } from "date-fns";
import HapticPressable from "../../atoms/HapticPressable";
import type { Transaction } from "@/types/Transaction";

const usdcIcon = require("@/assets/icons/usdc.png");
const SOLSCAN_BASE = "https://solscan.io/tx";

interface TransactionDetailModalProps {
  visible: boolean;
  onClose: () => void;
  item: Transaction | null;
}

export function TransactionDetailModal({
  visible,
  onClose,
  item,
}: TransactionDetailModalProps) {
  const copyIconColor = "rgba(0,0,0,0.3)";

  if (!item) return null;

  const copyToClipboard = async (text: string) => {
    await Clipboard.setStringAsync(text);
    notificationAsync(NotificationFeedbackType.Success);
  };

  const transactionType = item.type === "sent" ? "Sent" : "Received";
  const counterparty = item.type === "sent" ? item.to : item.from;
  const dateLabel = format(new Date(item.timestamp), "MMM d, yyyy 'at' h:mma");
  const amountNum = parseFloat(item.amount);
  const isPending = item.status === "PENDING";
  const explorerUrl = `${SOLSCAN_BASE}/${item.signature}?cluster=devnet`;

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
            source={usdcIcon as ImageSourcePropType}
            className="h-16 w-16 rounded-full"
          />
          <View className="absolute right-0 top-0 overflow-hidden rounded-full bg-white">
            <Ionicons
              name={isPending ? "time" : "checkmark-circle"}
              size={16}
              color={isPending ? "#FF9500" : "#34C759"}
            />
          </View>
        </View>

        <Typography weight="600" className="mb-1 text-sm text-black/30">
          {transactionType}
        </Typography>

        <Typography weight="700" className="mb-1 text-3xl">
          {amountNum.toFixed(2)} {item.token}
        </Typography>

        <Typography weight="600" className="mb-4 text-sm text-black/30">
          {dateLabel}
        </Typography>

        <View className="w-full pb-3">
          <View className={rowClass}>
            <Typography weight="600">Status</Typography>
            <View className="flex-row items-center">
              <Typography
                className={isPending ? "mr-1 text-warning" : "mr-1 text-success"}
              >
                {isPending ? "Pending…" : "Completed"}
              </Typography>
              <Ionicons
                name={isPending ? "time" : "checkmark-circle"}
                size={14}
                color={isPending ? "#FF9500" : "#34C759"}
              />
            </View>
          </View>

          <View className={rowClass}>
            <Typography weight="600" className="text-black/30">
              {item.type === "sent" ? "To" : "From"}
            </Typography>
            <TouchableOpacity
              className="flex-row items-center"
              onPress={() => copyToClipboard(counterparty)}
            >
              <Typography weight="600" className="mr-1">
                {truncateAddress(counterparty)}
              </Typography>
              <Ionicons name="copy-outline" size={14} color={copyIconColor} />
            </TouchableOpacity>
          </View>

          <View className={rowClass}>
            <Typography weight="600" className="text-black/30">
              Onchain transaction
            </Typography>
            <TouchableOpacity
              className="flex-row items-center"
              onPress={() => copyToClipboard(item.signature)}
            >
              <Typography weight="600" className="mr-1">
                {truncateAddress(item.signature)}
              </Typography>
              <Ionicons name="copy-outline" size={14} color={copyIconColor} />
            </TouchableOpacity>
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

          <View className={rowClass}>
            <Typography weight="600" className="text-black/30">
              Explorer
            </Typography>
            <TouchableOpacity
              className="flex-row items-center"
              onPress={() => Linking.openURL(explorerUrl)}
            >
              <Typography weight="600" className="mr-1">
                View on Solscan
              </Typography>
              <Ionicons name="open-outline" size={14} color={copyIconColor} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </ActionModal>
  );
}
