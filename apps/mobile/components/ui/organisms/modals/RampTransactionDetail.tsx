import React from "react";
import { TouchableOpacity, View } from "react-native";
import { FontAwesome6, Ionicons } from "@expo/vector-icons";
import { format } from "date-fns";
import { ActionModal } from "../ActionModal";
import { Typography } from "../../atoms/Typography";
import HapticPressable from "../../atoms/HapticPressable";
import { RampMark } from "@/components/ui/atoms/RampMark";
import { cn } from "@/utils/cn";
import { truncateAddress } from "@/utils/helper";
import { activityDetailTimestamp, type ActivityEntry } from "@/utils/activity";
import {
  formatDollarsMinor,
  formatNaira,
  formatRate,
  rampAmounts,
} from "@/utils/ramp";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

export interface StatusMeta {
  label: string;
  color: string;
  icon: IoniconName;
  textClass: string;
}

/**
 * The receipt for a naira deposit or bank send. Leads with the money the
 * Consumer recognises, then the conversion and the bank or person, and leaves
 * out network fees, which mean nothing on a bank transfer.
 */
export function RampTransactionDetail({
  visible,
  onClose,
  item,
  status,
  onCopy,
}: {
  visible: boolean;
  onClose: () => void;
  item: ActivityEntry;
  status: StatusMeta;
  onCopy: (text: string) => Promise<void>;
}) {
  const ramp = item.ramp!;
  const isSend = ramp.direction === "send";
  const muted = "rgba(0,0,0,0.3)";
  const { headline, conversion } = rampAmounts(
    ramp,
    item.amountRaw,
    item.decimals
  );
  const date = format(
    new Date(activityDetailTimestamp(item)),
    "MMM d, yyyy 'at' h:mma"
  );
  const rowClass = "flex-row justify-between items-center py-2";
  const naira = formatNaira(ramp.fiatAmountMinor, ramp.fiatDecimals);
  const dollars = formatDollarsMinor(item.amountRaw, item.decimals);

  return (
    <ActionModal visible={visible} onClose={onClose}>
      <View className="items-center">
        <HapticPressable
          onPress={onClose}
          className="absolute -right-4 -top-4 p-4"
        >
          <FontAwesome6 name="xmark" size={20} color={muted} />
        </HapticPressable>

        <View className="relative mb-3">
          <RampMark ramp={ramp} size={64} />
          <View className="absolute right-0 top-0 overflow-hidden rounded-full bg-white">
            <Ionicons name={status.icon} size={16} color={status.color} />
          </View>
        </View>

        <Typography weight="600" className="mb-1 text-sm text-black/30">
          {isSend ? "Sent to a bank" : "Added from your bank"}
        </Typography>

        <Typography weight="700" className="mb-1 text-3xl">
          {headline}
        </Typography>

        <View className="mb-1 flex-row items-center gap-1.5">
          <Ionicons name="return-down-forward" size={14} color={muted} />
          <Typography weight="600" className="text-base text-black/30">
            {conversion}
          </Typography>
        </View>

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
              {isSend ? "To" : "From"}
            </Typography>
            <Typography weight="600" numberOfLines={1} className="ml-6 shrink">
              {isSend
                ? (ramp.counterpartyName ?? "Bank account")
                : "Your bank transfer"}
            </Typography>
          </View>

          {isSend && (ramp.bankName || ramp.accountLast4) && (
            <View className={rowClass}>
              <Typography weight="600" className="text-black/30">
                Bank
              </Typography>
              <Typography
                weight="600"
                numberOfLines={1}
                className="ml-6 shrink"
              >
                {[
                  ramp.bankName,
                  ramp.accountLast4 ? `•••• ${ramp.accountLast4}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Typography>
            </View>
          )}

          <View className={rowClass}>
            <Typography weight="600" className="text-black/30">
              {isSend ? "They get" : "You paid"}
            </Typography>
            <Typography weight="600">{naira}</Typography>
          </View>

          <View className={rowClass}>
            <Typography weight="600" className="text-black/30">
              {isSend ? "From your Account" : "Into your Account"}
            </Typography>
            <Typography weight="600">{dollars}</Typography>
          </View>

          {ramp.rate && (
            <View className={rowClass}>
              <Typography weight="600" className="text-black/30">
                Rate
              </Typography>
              <Typography weight="600">
                {formatRate(ramp.rate)} per $1
              </Typography>
            </View>
          )}

          {ramp.feeMinor && (
            <View className={rowClass}>
              <Typography weight="600" className="text-black/30">
                Partner fee
              </Typography>
              <Typography weight="600">
                {formatDollarsMinor(ramp.feeMinor, 6)}
              </Typography>
            </View>
          )}

          <View className={rowClass}>
            <Typography weight="600" className="text-black/30">
              Onchain transaction
            </Typography>
            {item.signature ? (
              <TouchableOpacity
                className="flex-row items-center"
                onPress={() => onCopy(item.signature as string)}
              >
                <Typography weight="600" className="mr-1">
                  {truncateAddress(item.signature)}
                </Typography>
                <Ionicons name="copy-outline" size={14} color={muted} />
              </TouchableOpacity>
            ) : (
              <Typography weight="600" className="text-black/30">
                Pending
              </Typography>
            )}
          </View>
        </View>
      </View>
    </ActionModal>
  );
}
