import React from "react";
import { TouchableOpacity, View } from "react-native";
import { FontAwesome6, Ionicons } from "@expo/vector-icons";
import { format } from "date-fns";

import { ActionModal } from "../ActionModal";
import { Typography } from "../../atoms/Typography";
import HapticPressable from "../../atoms/HapticPressable";
import { SwapMarks } from "@/components/ui/organisms/ActivityItem";
import { usePalette } from "@/hooks/usePalette";
import { cn } from "@/utils/cn";
import { truncateAddress } from "@/utils/helper";
import {
  activityDetailTimestamp,
  swapAmountLabel,
  type ActivityEntry,
  type SwapSummary,
} from "@/utils/activity";
import {
  Group,
  Row,
  statusColor,
  Value,
  type StatusMeta,
} from "./RampTransactionDetail";

/**
 * The receipt for a swap. Leads with what the Consumer got, says what it cost
 * beside it, then lists the trade and the route it took.
 */
export function SwapTransactionDetail({
  visible,
  onClose,
  item,
  swap,
  status,
  onCopy,
}: {
  visible: boolean;
  onClose: () => void;
  item: ActivityEntry;
  swap: SwapSummary;
  status: StatusMeta;
  onCopy: (text: string) => Promise<void>;
}) {
  const palette = usePalette();
  const muted = palette.fg(0.3);
  const date = format(new Date(activityDetailTimestamp(item)), "MMM d, h:mma");
  const received = swapAmountLabel(swap.receive);
  const paid = swapAmountLabel(swap.pay);
  const unknown = swap.receiving
    ? item.status === "pending"
      ? "Swapping…"
      : "Checking…"
    : "Not recorded";
  // Led by what the Consumer got, unless its precision was never recorded.
  const lead = received ? `+${received}` : paid ? `-${paid}` : null;
  const beside = received && paid ? `for ${paid} · ${date}` : date;

  return (
    <ActionModal visible={visible} onClose={onClose}>
      <View className="items-center">
        <HapticPressable
          onPress={onClose}
          className="absolute -right-4 -top-4 p-4"
        >
          <FontAwesome6 name="xmark" size={20} color={muted} />
        </HapticPressable>

        <View className="mt-8 w-full flex-row items-center gap-4">
          <SwapMarks swap={swap} size={40} cutout="border-card" />
          <View className="flex-1 items-end">
            {lead && (
              <Typography
                weight="700"
                numberOfLines={1}
                adjustsFontSizeToFit
                className="text-3xl text-foreground"
              >
                {lead}
              </Typography>
            )}
            <Typography
              weight="500"
              className="mt-0.5 text-sm text-foreground/40"
            >
              {beside}
            </Typography>
          </View>
        </View>

        <Group>
          <Row label="Status">
            <Typography className={cn("mr-1", status.textClass)}>
              {status.label}
            </Typography>
            <Ionicons
              name={status.icon}
              size={14}
              color={statusColor(status.tone, palette)}
            />
          </Row>
        </Group>

        <Group title="Swap">
          <Row label="You paid">
            <Value>{paid ?? unknown}</Value>
          </Row>
          <Row label="You received">
            <Value>{received ?? unknown}</Value>
          </Row>
          {swap.venues.length > 0 && (
            <Row label="Route">
              <Value>{swap.venues.join(" → ")}</Value>
            </Row>
          )}
        </Group>

        <View className="mt-3 w-full px-1 pb-3">
          <Row label="Onchain transaction">
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
          </Row>
          <Row label="Onchain fees">
            <Typography
              weight="500"
              className="mr-1 text-[13px] text-foreground/30"
            >
              Prydd⁺
            </Typography>
            <Typography weight="500" className="text-success">
              Covered
            </Typography>
          </Row>
        </View>
      </View>
    </ActionModal>
  );
}
