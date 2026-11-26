import { useEffect } from "react";
import { Image, View, type ImageSourcePropType } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { Typography } from "../atoms/Typography";
import type {
  ActivityEntry,
  EarnMovement,
  SwapSummary,
} from "@/utils/activity";
import {
  EARN_PROVIDER_NAMES,
  earnAmountLabel,
  earnUsdLabel,
  statusLabel,
  swapAmountLabel,
  swapPairLabel,
  swapVenueLabel,
} from "@/utils/activity";
import { truncateAddress } from "@/utils/helper";
import { formatAmount } from "@/utils/solana";
import HapticPressable from "../atoms/HapticPressable";
import { usePalette } from "@/hooks/usePalette";
import { cn } from "@/utils/cn";
import { describeToken } from "@/utils/tokens";
import { formatUsdFromString } from "@/utils/balances";
import { TokenMark } from "@/components/ui/atoms/TokenMark";
import { MerchantAvatar } from "@/components/ui/atoms/MerchantAvatar";
import { formatMoney } from "@/utils/money";
import { GLASS, useOnPhoto } from "@/components/ui/glass";
import { RampMark } from "@/components/ui/atoms/RampMark";
import {
  formatDollarsMinor,
  formatNaira,
  rampCounterparty,
  rampOutcome,
} from "@/utils/ramp";

export type ActivityItemProps = ActivityEntry & {
  onPress?: () => void;
};

/** Row colours, white on the Home photo and the mode's own everywhere else. */
function useRowTone() {
  const onPhoto = useOnPhoto();
  const palette = usePalette();
  return onPhoto
    ? {
        ink: "text-white",
        muted: "text-white/[0.56]",
        up: GLASS.up,
        down: GLASS.down,
        cutout: "border-white",
        hairline: "border-black/[0.08]",
        glyph: "#00000059",
        chevron: "#00000040",
        placeholder: "bg-white/40",
      }
    : {
        ink: "text-foreground",
        muted: "text-foreground/30",
        up: "text-success",
        down: "text-destructive",
        cutout: "border-background",
        hairline: "border-foreground/[0.08]",
        glyph: palette.fg(0.35),
        chevron: palette.fg(0.25),
        placeholder: "bg-foreground/[0.08]",
      };
}

export function ActivityItem({ onPress, ...entry }: ActivityItemProps) {
  const tone = useRowTone();
  // An account event has no amount, no token and no counterparty. Falling
  // through would render it as a nameless token and a "+0", which reads as a
  // broken transfer rather than the security notice it is.
  if (entry.kind === "security") {
    return <AccountEventItem entry={entry} onPress={onPress} />;
  }

  // A Payment waiting on this phone has no token and no amount that has moved.
  // Falling through would render the Merchant's price as a token figure and a
  // "-0", which reads as a Payment that already went out.
  if (entry.kind === "awaiting") {
    return <AwaitingPaymentItem entry={entry} onPress={onPress} />;
  }

  if (entry.ramp) {
    return <RampItem entry={entry} onPress={onPress} />;
  }

  if (entry.earn) {
    return <EarnItem entry={entry} earn={entry.earn} onPress={onPress} />;
  }

  if (entry.swap) {
    return <SwapItem entry={entry} swap={entry.swap} onPress={onPress} />;
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
  // Dollars are what a Consumer holds, so a USDC row says dollars once rather
  // than a token amount with its dollar value underneath.
  const isDollars = symbol === "USDC";
  const usd = isDollars ? null : (entry.usdValue ?? null);
  const sign = isSend ? "-" : "+";
  // A Payment renders as a debit titled with the merchant's display name —
  // never an address, no chain vocabulary. Payments arrive as SEND, so the
  // existing debit sign + text-destructive styling apply unchanged.
  const label = isPayment
    ? (entry.merchantName ?? "Merchant")
    : entry.isSwap
      ? isSend
        ? "You paid"
        : "You received"
      : isSend
        ? `To: ${truncateAddress(entry.counterparty)}`
        : `From: ${truncateAddress(entry.counterparty)}`;

  const valueColorClass = isInactive
    ? tone.muted
    : isSend
      ? tone.down
      : tone.up;

  return (
    <HapticPressable
      className="flex-row items-center gap-3.5 py-3"
      onPress={onPress}
    >
      {isPayment ? (
        <MerchantAvatar
          logoUrl={entry.merchantLogoUrl}
          category={entry.merchantCategory}
        />
      ) : (
        <TokenMark
          mint={entry.mint}
          label={name}
          iconUrl={entry.iconUrl}
          size={40}
        />
      )}
      <View className="flex-1 flex-row items-center justify-between">
        <View className="flex-col">
          <Typography weight="600" className={cn("mb-0.5", tone.ink)}>
            {statusLabel(entry)}
          </Typography>
          <Typography weight="500" className={cn("text-sm", tone.muted)}>
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
            {isDollars
              ? formatDollarsMinor(entry.amountRaw, entry.decimals)
              : `${amount}${symbol ? ` ${symbol}` : ""}`}
          </Typography>
          {usd !== null && (
            // What it was worth when it happened, not what the same tokens
            // would fetch today. Shown for every asset, since "5 SOL" alone
            // does not tell a Consumer what they received.
            <Typography weight="500" className={cn("text-xs", tone.muted)}>
              {formatUsdFromString(usd)}
            </Typography>
          )}
        </View>
      </View>
    </HapticPressable>
  );
}

/**
 * A naira deposit or bank send. Reads like any other row: the naira leads on
 * the right with the dollars it became beneath, and a small dollar coin on the
 * bank's badge says the money was converted.
 */
function RampItem({
  entry,
  onPress,
}: {
  entry: ActivityEntry;
  onPress?: () => void;
}) {
  const tone = useRowTone();
  const ramp = entry.ramp!;
  if (ramp.refund) return <RefundItem entry={entry} onPress={onPress} />;
  const isSend = entry.direction === "send";
  // The dollars came back, so the naira never left: say so on the send itself.
  const returned = rampOutcome(ramp, entry.status) === "refunded";
  const isInactive =
    entry.status === "pending" || entry.status === "failed" || returned;
  const naira = formatNaira(ramp.fiatAmountMinor, ramp.fiatDecimals);
  const dollars = formatDollarsMinor(entry.amountRaw, entry.decimals);
  const valueColorClass = isInactive
    ? tone.muted
    : isSend
      ? tone.down
      : tone.up;

  return (
    <HapticPressable
      className="flex-row items-center gap-3.5 py-3"
      onPress={onPress}
    >
      {/* Two same-size marks, Revolut style, in the order the money moved:
          where it came from on top, where it went below. */}
      <View className="h-[40px] w-[40px]">
        <View className="absolute left-0 top-0">
          {isSend ? (
            <TokenMark mint={entry.mint} label="$" size={26} />
          ) : (
            <RampMark ramp={ramp} size={26} />
          )}
        </View>
        <View
          className={cn(
            "absolute -bottom-0.5 -right-0.5 rounded-full border-2",
            tone.cutout
          )}
        >
          {isSend ? (
            <RampMark ramp={ramp} size={26} />
          ) : (
            <TokenMark mint={entry.mint} label="$" size={26} />
          )}
        </View>
      </View>
      <View className="flex-1 flex-row items-center justify-between gap-3">
        <View className="flex-1 flex-col">
          <Typography weight="600" className={cn("mb-0.5", tone.ink)}>
            {returned ? "Returned" : statusLabel(entry)}
          </Typography>
          <View className="flex-row">
            <Typography
              weight="500"
              numberOfLines={1}
              className={cn("shrink text-sm", tone.muted)}
            >
              {rampCounterparty(ramp)}
            </Typography>
            <Typography weight="500" className={cn("text-sm", tone.muted)}>
              {isSend ? " · USD → NGN" : " · NGN → USD"}
            </Typography>
          </View>
        </View>
        <View className="items-end gap-0.5">
          <Typography
            weight="600"
            className={cn(
              "text-sm tracking-[0.5px]",
              valueColorClass,
              (entry.status === "failed" || returned) && "line-through"
            )}
          >
            {isSend ? "-" : "+"}
            {naira}
          </Typography>
          <Typography weight="500" className={cn("text-xs", tone.muted)}>
            {dollars}
          </Typography>
        </View>
      </View>
    </HapticPressable>
  );
}

/** Two token marks, paid on top and received below, as the bank rows draw. */
export function SwapMarks({
  swap,
  size = 26,
  cutout,
}: {
  swap: SwapSummary;
  size?: number;
  cutout: string;
}) {
  const box = Math.round(size * 1.54);
  return (
    <View style={{ width: box, height: box }}>
      <View className="absolute left-0 top-0">
        <TokenMark
          mint={swap.pay.mint}
          label={swap.pay.symbol ?? "?"}
          iconUrl={swap.pay.iconUrl}
          size={size}
        />
      </View>
      <View
        className={cn(
          "absolute -bottom-0.5 -right-0.5 rounded-full border-2",
          cutout
        )}
      >
        <TokenMark
          mint={swap.receive.mint}
          label={swap.receive.symbol ?? "?"}
          iconUrl={swap.receive.iconUrl}
          size={size}
        />
      </View>
    </View>
  );
}

/**
 * A swap as one trade: the pair it traded, where it was routed, and both
 * amounts, received above paid.
 */
function SwapItem({
  entry,
  swap,
  onPress,
}: {
  entry: ActivityEntry;
  swap: SwapSummary;
  onPress?: () => void;
}) {
  const tone = useRowTone();
  const settled = entry.status === "confirmed";
  const failed = entry.status === "failed";
  const route = swapVenueLabel(swap);
  const received = swapAmountLabel(swap.receive);
  const paid = swapAmountLabel(swap.pay);
  // Where it is going is known from the quote; how it is doing is not, so a
  // running swap names its route when it has one and says it is swapping
  // when it does not.
  const subtitle = failed ? statusLabel(entry) : (route ?? statusLabel(entry));

  return (
    <HapticPressable
      className="flex-row items-center gap-3.5 py-3"
      onPress={onPress}
    >
      <SwapMarks swap={swap} cutout={tone.cutout} />
      <View className="flex-1 flex-row items-center justify-between gap-3">
        <View className="flex-1 flex-col">
          <Typography
            weight="600"
            numberOfLines={1}
            className={cn("mb-0.5", tone.ink)}
          >
            {swapPairLabel(swap)}
          </Typography>
          <Typography
            weight="500"
            numberOfLines={1}
            className={cn("text-sm", tone.muted)}
          >
            {subtitle}
          </Typography>
        </View>
        <View className="items-end gap-0.5">
          {received ? (
            <Typography
              weight="600"
              className={cn(
                "text-sm tracking-[0.5px]",
                settled ? tone.up : tone.muted,
                failed && "line-through"
              )}
            >
              +{received}
            </Typography>
          ) : (
            swap.receiving &&
            !failed && <AmountPlaceholder className={tone.placeholder} />
          )}
          {paid && (
            <Typography
              weight="600"
              className={cn(
                "text-sm tracking-[0.5px]",
                failed ? tone.muted : tone.down,
                failed && "line-through"
              )}
            >
              -{paid}
            </Typography>
          )}
        </View>
      </View>
    </HapticPressable>
  );
}

const EARN_LOGOS: Record<EarnMovement["provider"], ImageSourcePropType> = {
  kamino: require("@/assets/icons/kamino.png"),
  jupiter: require("@/assets/icons/jupiter.png"),
};

export function EarnMark({
  provider,
  size = 40,
}: {
  provider: EarnMovement["provider"];
  size?: 40 | 64;
}) {
  return (
    <Image
      source={EARN_LOGOS[provider]}
      className={cn(
        "rounded-full",
        size === 64 ? "h-[64px] w-[64px]" : "h-[40px] w-[40px]"
      )}
      accessibilityIgnoresInvertColors
    />
  );
}

/**
 * An Earn deposit or withdrawal as the one thing the Consumer did: dollars
 * moved into or out of a provider. Unsigned, because the money stayed theirs.
 */
function EarnItem({
  entry,
  earn,
  onPress,
}: {
  entry: ActivityEntry;
  earn: EarnMovement;
  onPress?: () => void;
}) {
  const tone = useRowTone();
  const isInactive = entry.status === "pending" || entry.status === "failed";
  const usd = earnUsdLabel(entry);

  return (
    <HapticPressable
      className="flex-row items-center gap-3.5 py-3"
      onPress={onPress}
    >
      <EarnMark provider={earn.provider} />
      <View className="flex-1 flex-row items-center justify-between gap-3">
        <View className="flex-1 flex-col">
          <Typography
            weight="600"
            numberOfLines={1}
            className={cn("mb-0.5", tone.ink)}
          >
            {EARN_PROVIDER_NAMES[earn.provider]}
          </Typography>
          <Typography
            weight="500"
            numberOfLines={1}
            className={cn("text-sm", tone.muted)}
          >
            {statusLabel(entry)}
          </Typography>
        </View>
        <View className="items-end gap-0.5">
          <Typography
            weight="600"
            className={cn(
              "text-sm tracking-[0.5px]",
              isInactive ? tone.muted : tone.ink,
              entry.status === "failed" && "line-through"
            )}
          >
            {earnAmountLabel(entry)}
          </Typography>
          {usd !== null && (
            <Typography weight="500" className={cn("text-xs", tone.muted)}>
              {usd}
            </Typography>
          )}
        </View>
      </View>
    </HapticPressable>
  );
}

/**
 * Holds the place of an amount not known yet, at the height of the line it
 * stands in for, so the row does not shift when the figure arrives.
 */
function AmountPlaceholder({ className }: { className: string }) {
  const reduceMotion = useReducedMotion();
  const shown = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) return;
    shown.value = withRepeat(withTiming(0.4, { duration: 800 }), -1, true);
  }, [reduceMotion, shown]);

  const pulse = useAnimatedStyle(() => ({ opacity: shown.value }));

  return (
    <Animated.View style={pulse}>
      <View className={cn("my-[3px] h-3.5 w-20 rounded-full", className)} />
    </Animated.View>
  );
}

/**
 * Dollars a bank send gave back after the payout did not happen. The dollars
 * lead, with the naira the send was for beneath.
 */
function RefundItem({
  entry,
  onPress,
}: {
  entry: ActivityEntry;
  onPress?: () => void;
}) {
  const tone = useRowTone();
  const ramp = entry.ramp!;
  return (
    <HapticPressable
      className="flex-row items-center gap-3.5 py-3"
      onPress={onPress}
    >
      <View className="h-[40px] w-[40px]">
        <View className="absolute left-0 top-0">
          <RampMark ramp={ramp} size={26} />
        </View>
        <View
          className={cn(
            "absolute -bottom-0.5 -right-0.5 rounded-full border-2",
            tone.cutout
          )}
        >
          <TokenMark mint={entry.mint} label="$" size={26} />
        </View>
      </View>
      <View className="flex-1 flex-row items-center justify-between gap-3">
        <View className="flex-1 flex-col">
          <Typography weight="600" className={cn("mb-0.5", tone.ink)}>
            {statusLabel(entry)}
          </Typography>
          <Typography
            weight="500"
            numberOfLines={1}
            className={cn("text-sm", tone.muted)}
          >
            {rampCounterparty(ramp)}
          </Typography>
        </View>
        <View className="items-end gap-0.5">
          <Typography
            weight="600"
            className={cn("text-sm tracking-[0.5px]", tone.up)}
          >
            +{formatDollarsMinor(entry.amountRaw, entry.decimals)}
          </Typography>
          <Typography weight="500" className={cn("text-xs", tone.muted)}>
            {formatNaira(ramp.fiatAmountMinor, ramp.fiatDecimals)}
          </Typography>
        </View>
      </View>
    </HapticPressable>
  );
}

/**
 * A Payment a checkout could not finish, in the feed as the thing it is: not
 * money that moved, but money that will not move until the Consumer says so.
 *
 * Carries the Merchant's name and their price, and says what is being asked.
 * It is the one row here that is an instruction rather than a record, so it
 * keeps the chevron: everything else in this feed opens a receipt.
 */
function AwaitingPaymentItem({
  entry,
  onPress,
}: {
  entry: ActivityEntry;
  onPress?: () => void;
}) {
  const tone = useRowTone();
  return (
    <HapticPressable
      className="flex-row items-center gap-3.5 py-3"
      onPress={onPress}
    >
      <View
        className={cn(
          "size-10 items-center justify-center rounded-full border",
          tone.hairline
        )}
      >
        <Ionicons name="storefront-outline" size={18} color={tone.glyph} />
      </View>
      <View className="flex-1 flex-row items-center justify-between">
        <View className="flex-col">
          <Typography weight="600" className={cn("mb-0.5", tone.ink)}>
            {statusLabel(entry)}
          </Typography>
          <Typography weight="500" className={cn("text-sm", tone.muted)}>
            {entry.merchantName ?? "Merchant"}
          </Typography>
        </View>
        <View className="flex-row items-center gap-1">
          <Typography
            weight="600"
            className={cn("text-sm tracking-[0.5px]", tone.muted)}
          >
            {entry.displayCurrency && entry.displayAmountMinor
              ? formatMoney(entry.displayCurrency, entry.displayAmountMinor)
              : ""}
          </Typography>
          <Ionicons name="chevron-forward" size={14} color={tone.chevron} />
        </View>
      </View>
    </HapticPressable>
  );
}

const EVENT_ILLUSTRATIONS = {
  added: require("@/assets/illustrations/recovery-key-added.webp"),
  removed: require("@/assets/illustrations/recovery-key-removed.webp"),
  renamed: require("@/assets/illustrations/account-renamed.webp"),
};

/**
 * The 3D object for an account event, standing on its own with no disc.
 *
 * What happened is part of the object itself: the charm on the key ring
 * carries the plus or the cross, so there is no separate badge to place.
 */
export function AccountEventMark({
  kind,
  size = 40,
}: {
  kind: ActivityEntry["securityKind"];
  size?: number;
}) {
  const source =
    kind === "wallet_renamed"
      ? EVENT_ILLUSTRATIONS.renamed
      : kind === "recovery_key_removed"
        ? EVENT_ILLUSTRATIONS.removed
        : EVENT_ILLUSTRATIONS.added;

  return (
    <Image
      source={source}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
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
  const tone = useRowTone();

  return (
    <HapticPressable
      className="flex-row items-center gap-3.5 py-3"
      onPress={onPress}
    >
      <AccountEventMark kind={entry.securityKind} />
      <View className="flex-1 flex-col">
        <Typography weight="600" className={cn("mb-0.5", tone.ink)}>
          {label}
        </Typography>
        {entry.securitySubject && (
          <Typography
            weight="500"
            className={cn("text-sm", tone.muted)}
            numberOfLines={1}
          >
            {entry.securitySubject}
          </Typography>
        )}
      </View>
    </HapticPressable>
  );
}
