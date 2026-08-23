import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "../atoms/Typography";
import type { ActivityEntry } from "@/utils/activity";
import { statusLabel } from "@/utils/activity";
import { truncateAddress } from "@/utils/helper";
import { formatAmount } from "@/utils/solana";
import HapticPressable from "../atoms/HapticPressable";
import { cn } from "@/utils/cn";
import { describeToken } from "@/utils/tokens";
import { formatUsdFromString } from "@/utils/balances";
import { TokenMark } from "@/components/ui/atoms/TokenMark";

export type ActivityItemProps = ActivityEntry & {
  onPress?: () => void;
};

export function ActivityItem({ onPress, ...entry }: ActivityItemProps) {
  // An account event has no amount, no token and no counterparty. Falling
  // through would render it as a nameless token and a "+0", which reads as a
  // broken transfer rather than the security notice it is.
  if (entry.kind === "security") {
    return <AccountEventItem entry={entry} onPress={onPress} />;
  }

  const isSend = entry.direction === "send";
  const isPayment = entry.kind === "payment";
  const isInactive = entry.status === "pending" || entry.status === "failed";

  const amount = formatAmount(entry.amountRaw, entry.decimals);
  // Named from the shared token table, so SOL reads as SOL here and on the
  // Investments screen rather than as a bare number in one of them.
  const { name, symbol } = describeToken(
    entry.mint,
    entry.tokenSymbol,
    entry.tokenName
  );
  const usd = entry.usdValue ?? null;
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
      <TokenMark
        mint={entry.mint}
        label={name}
        iconUrl={entry.iconUrl}
        size={40}
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
        <View className="items-end gap-0.5">
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
          {usd !== null && (
            // What it was worth when it happened, not what the same tokens
            // would fetch today. Shown for every asset, since "5 SOL" alone
            // does not tell a Consumer what they received.
            <Typography weight="500" className="text-xs text-black/30">
              {formatUsdFromString(usd)}
            </Typography>
          )}
        </View>
      </View>
    </HapticPressable>
  );
}

/**
 * A muted key in a thin ring, badged with what happened to it.
 *
 * Deliberately quieter than a token mark: these rows carry no amount, and
 * giving them a filled colour badge would make an account note look like the
 * loudest money on the screen.
 */
export function AccountEventMark({
  kind,
  size = 40,
}: {
  kind: ActivityEntry["securityKind"];
  size?: number;
}) {
  const renamed = kind === "wallet_renamed";
  const badge = kind === "recovery_key_removed" ? "close" : "add";

  return (
    <View
      className="items-center justify-center rounded-full border border-black/[0.08]"
      style={{ width: size, height: size }}
    >
      <Ionicons
        name={renamed ? "create-outline" : "key-outline"}
        size={size * 0.45}
        color="#00000059"
      />
      {!renamed && (
        <View
          className="absolute -right-0.5 -top-0.5 items-center justify-center rounded-full border border-white bg-black/[0.08]"
          style={{ width: size * 0.4, height: size * 0.4 }}
        >
          <Ionicons name={badge} size={size * 0.25} color="#00000080" />
        </View>
      )}
    </View>
  );
}

function AccountEventItem({
  entry,
  onPress,
}: {
  entry: ActivityEntry;
  onPress?: () => void;
}) {
  const label = entry.securityLabel ?? "Account updated";

  return (
    <HapticPressable
      className="flex-row items-center gap-3.5 py-3"
      onPress={onPress}
    >
      <AccountEventMark kind={entry.securityKind} />
      <View className="flex-1 flex-col">
        <Typography weight="600" className="mb-0.5">
          {label}
        </Typography>
        {entry.securitySubject && (
          <Typography
            weight="500"
            className="text-sm text-black/30"
            numberOfLines={1}
          >
            {entry.securitySubject}
          </Typography>
        )}
      </View>
    </HapticPressable>
  );
}
