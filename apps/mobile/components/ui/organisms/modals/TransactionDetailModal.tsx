import React from "react";
import {
  View,
  Image,
  TouchableOpacity,
  ImageSourcePropType,
} from "react-native";
import { ActionModal } from "../ActionModal";
import { ActivityItemProps } from "../ActivityItem";
import {
  FontAwesome6,
  Ionicons,
  MaterialCommunityIcons,
} from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { notificationAsync, NotificationFeedbackType } from "expo-haptics";
import { formatAmount } from "@/utils/solana";
import { truncateAddress } from "@/utils/helper";
import { Typography } from "../../atoms/Typography";
import { format } from "date-fns";
import HapticPressable from "../../atoms/HapticPressable";

interface TransactionDetailModalProps {
  visible: boolean;
  onClose: () => void;
  item: ActivityItemProps | null;
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

  const transactionType = item.side === "send" ? "Sent" : "Received";
  const amount = formatAmount(item.amount, item.token.decimal);
  const date = format(new Date(item.date), "MMM d, yyyy 'at' h:mma");

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
            source={item.token.icon as ImageSourcePropType}
            className="h-16 w-16 rounded-full"
          />
          <View className="absolute right-0 top-0 overflow-hidden rounded-full bg-white">
            <Ionicons name="checkmark-circle" size={16} color="#34C759" />
          </View>
        </View>

        <Typography weight="600" className="mb-1 text-sm text-black/30">
          {transactionType}
        </Typography>

        <Typography weight="700" className="mb-1 text-3xl">
          {amount} {item.token.symbol}
        </Typography>

        <Typography weight="600" className="mb-4 text-sm text-black/30">
          {date}
        </Typography>

        <View className="w-full pb-3">
          <View className={rowClass}>
            <Typography weight="600">Status</Typography>
            <View className="flex-row items-center">
              <Typography className="mr-1 text-success">Completed</Typography>
              <Ionicons name="checkmark-circle" size={14} color="#34C759" />
            </View>
          </View>

          <View className={rowClass}>
            <Typography weight="600" className="text-black/30">
              From
            </Typography>
            <TouchableOpacity
              className="flex-row items-center"
              onPress={() => copyToClipboard("CZ2R...K4Aj")}
            >
              <Typography weight="600" className="mr-1">
                CZ2R...K4Aj
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
              onPress={() => copyToClipboard(item.transactionHash)}
            >
              <Typography weight="600" className="mr-1">
                {truncateAddress(item.transactionHash)}
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

          {item.incognito && (
            <View className={rowClass}>
              <View className="flex-row items-center gap-1">
                <Typography weight="600" className="text-black/30">
                  Hide My Wallet
                </Typography>
                <MaterialCommunityIcons
                  name="shield-half-full"
                  size={13}
                  color="rgba(0,0,0,0.3)"
                />
              </View>
              <Typography weight="600">Enabled</Typography>
            </View>
          )}
        </View>
      </View>
    </ActionModal>
  );
}
