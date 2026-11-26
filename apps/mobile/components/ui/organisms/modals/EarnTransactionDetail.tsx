import React from "react";
import { TouchableOpacity, View } from "react-native";
import { FontAwesome6, Ionicons } from "@expo/vector-icons";
import { format } from "date-fns";

import { ActionModal } from "../ActionModal";
import { Typography } from "../../atoms/Typography";
import HapticPressable from "../../atoms/HapticPressable";
import { EarnMark } from "@/components/ui/organisms/ActivityItem";
import { usePalette } from "@/hooks/usePalette";
import { truncateAddress } from "@/utils/helper";
import {
  activityDetailTimestamp,
  earnAmountLabel,
  earnUsdLabel,
  earnReceiptLabel,
  type ActivityEntry,
  type EarnMovement,
} from "@/utils/activity";
import { statusColor, type StatusMeta } from "./RampTransactionDetail";

/** The receipt for an Earn deposit or withdrawal. */
export function EarnTransactionDetail({
  visible,
  onClose,
  item,
  earn,
  status,
  onCopy,
}: {
  visible: boolean;
  onClose: () => void;
  item: ActivityEntry;
  earn: EarnMovement;
  status: StatusMeta;
  onCopy: (text: string) => Promise<void>;
}) {
  const palette = usePalette();
  const muted = palette.fg(0.3);
  const date = format(
    new Date(activityDetailTimestamp(item)),
    "MMM d, yyyy 'at' h:mma"
  );
  const rowClass = "flex-row justify-between items-center py-2";
  const usd = earnUsdLabel(item);

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
          <EarnMark provider={earn.provider} size={64} />
          <View className="absolute right-0 top-0 overflow-hidden rounded-full bg-card">
            <Ionicons
              name={status.icon}
              size={16}
              color={statusColor(status.tone, palette)}
            />
          </View>
        </View>

        <Typography weight="600" className="mb-1 text-sm text-foreground/30">
          {earnReceiptLabel(earn)}
        </Typography>

        <Typography weight="700" className="mb-1 text-3xl text-foreground">
          {earnAmountLabel(item)}
        </Typography>

        {usd !== null && (
          <Typography
            weight="600"
            className="mb-1 text-base text-foreground/30"
          >
            {usd}
          </Typography>
        )}

        <Typography weight="600" className="mb-4 text-sm text-foreground/30">
          {date}
        </Typography>

        <View className="w-full pb-3">
          <View className={rowClass}>
            <Typography weight="600" className="text-foreground/30">
              Onchain transaction
            </Typography>
            {item.signature ? (
              <TouchableOpacity
                className="flex-row items-center"
                onPress={() => onCopy(item.signature as string)}
              >
                <Typography weight="600" className="mr-1 text-foreground">
                  {truncateAddress(item.signature)}
                </Typography>
                <Ionicons name="copy-outline" size={14} color={muted} />
              </TouchableOpacity>
            ) : (
              <Typography weight="600" className="text-foreground/30">
                Pending
              </Typography>
            )}
          </View>

          <View className={rowClass}>
            <Typography weight="600" className="text-foreground/30">
              Onchain fees
            </Typography>
            <View className="flex-row items-center">
              <Typography
                weight="500"
                className="mr-1 text-[13px] text-foreground/30"
              >
                Prydd⁺
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
