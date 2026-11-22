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
import { formatDollarsMinor, formatNaira, formatRate } from "@/utils/ramp";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

export interface StatusMeta {
  label: string;
  color: string;
  icon: IoniconName;
  textClass: string;
}

const MUTED = "rgba(0,0,0,0.3)";

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View className="flex-row items-center justify-between py-2.5">
      <Typography weight="600" className="text-black/30">
        {label}
      </Typography>
      <View className="ml-6 shrink flex-row items-center justify-end">
        {children}
      </View>
    </View>
  );
}

function Value({ children }: { children: React.ReactNode }) {
  return (
    <Typography weight="600" numberOfLines={1} className="shrink text-right">
      {children}
    </Typography>
  );
}

/** One titled block of rows, the way Monzo gathers a receipt into sections. */
function Group({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mt-4 w-full">
      {title && (
        <Typography
          weight="600"
          className="mb-1.5 px-1 text-xs uppercase tracking-[0.6px] text-black/30"
        >
          {title}
        </Typography>
      )}
      <View className="rounded-2xl bg-black/[0.03] px-4 py-1">{children}</View>
    </View>
  );
}

/**
 * The receipt for a naira deposit or bank send. Leads with the money the
 * Consumer recognises, says the rate in a sentence, then groups who it was
 * with apart from how it was converted. Network fees are left out: they mean
 * nothing on a bank transfer.
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
  const naira = formatNaira(ramp.fiatAmountMinor, ramp.fiatDecimals);
  const dollars = formatDollarsMinor(item.amountRaw, item.decimals);
  const date = format(new Date(activityDetailTimestamp(item)), "MMM d, h:mma");
  const bank = [
    ramp.bankName,
    ramp.accountLast4 ? `•••• ${ramp.accountLast4}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ActionModal visible={visible} onClose={onClose}>
      <View className="items-center">
        <HapticPressable
          onPress={onClose}
          className="absolute -right-4 -top-4 p-4"
        >
          <FontAwesome6 name="xmark" size={20} color={MUTED} />
        </HapticPressable>

        {/* Two lines, side by side: the amount is what the eye should land on.
            No status badge on the logo; the Status row below already says it. */}
        <View className="mt-8 w-full flex-row items-center gap-4">
          <RampMark ramp={ramp} size={56} />
          <View className="flex-1 items-end">
            <Typography weight="700" className="text-3xl">
              {naira}
            </Typography>
            <Typography weight="500" className="mt-0.5 text-sm text-black/40">
              {dollars} · {date}
            </Typography>
          </View>
        </View>

        <Group>
          <Row label="Status">
            <Typography className={cn("mr-1", status.textClass)}>
              {status.label}
            </Typography>
            <Ionicons name={status.icon} size={14} color={status.color} />
          </Row>
        </Group>

        <Group title={isSend ? "Sent to" : "From"}>
          {isSend ? (
            <>
              <Row label="Name">
                <Value>{ramp.counterpartyName ?? "Bank account"}</Value>
              </Row>
              {bank !== "" && (
                <Row label="Bank">
                  <Value>{bank}</Value>
                </Row>
              )}
            </>
          ) : (
            <Row label="Source">
              <Value>Your bank transfer</Value>
            </Row>
          )}
        </Group>

        <Group title="Conversion">
          <Row label={isSend ? "They get" : "You paid"}>
            <Value>{naira}</Value>
          </Row>
          <Row label={isSend ? "From your Account" : "Into your Account"}>
            <Value>{dollars}</Value>
          </Row>
          {ramp.rate && (
            <Row label="Rate">
              <Value>{formatRate(ramp.rate)} = $1</Value>
            </Row>
          )}
          {ramp.feeMinor && (
            <Row label="Partner fee">
              <Value>{formatDollarsMinor(ramp.feeMinor, 6)}</Value>
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
                <Typography weight="600" className="mr-1">
                  {truncateAddress(item.signature)}
                </Typography>
                <Ionicons name="copy-outline" size={14} color={MUTED} />
              </TouchableOpacity>
            ) : (
              <Typography weight="600" className="text-black/30">
                Pending
              </Typography>
            )}
          </Row>
        </View>
      </View>
    </ActionModal>
  );
}
