import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  TouchableOpacity,
  ActivityIndicator,
  Keyboard,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Typography } from "@/components/ui/atoms/Typography";
import { Keypad } from "@/components/ui/molecules";
import { Image } from "expo-image";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { TokenMark } from "@/components/ui/atoms/TokenMark";
import { getUsdcMint } from "@/utils/cluster";
import { formatRawAmountShort, toAmountInput, toRawAmount } from "@/utils/swap";
import { heldSwapTokens, type HeldSwapToken } from "@/utils/swapTokens";
import { formatUsdFromString } from "@/utils/balances";
import { Ionicons } from "@expo/vector-icons";
import { formatAmount, truncateAddress } from "@/utils/helper";
import { useBalances } from "@/hooks/useBalances";
import { useEarnPosition } from "@/hooks/useEarn";
import HapticPressable from "../../atoms/HapticPressable";
import { cn } from "@/utils/cn";
import { usePalette } from "@/hooks/usePalette";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { displayMoney, usdcAsDollars } from "@/utils/display-money";
import { apiClient } from "@/utils/apiClient";
import {
  fiatAmountMinor,
  nairaAllowanceLeft,
  type FiatOrder,
} from "@/utils/fiat";
import { Footnote, PillButton } from "@/components/ui/kit";
import {
  BANK_SEND_ROUTE,
  useSendExecutor,
  type SendStart,
} from "@/hooks/useSendExecutor";
import { bucketAmount, trackFlow } from "@/utils/analytics";
import { groupAccountNumber, type BankRecipient } from "./bankAccount";
import { BankLogo } from "./BankLogo";
import { BankSheetFooter, BankSheetTop, DISPLAY } from "./BankSheetParts";

interface StepProps {
  onBack: () => void;
  onClose: () => void;
}

type AmountStepProps =
  | (StepProps & {
      mode: "crypto";
      recipient: string;
      /** The token being sent, chosen in the sheet the Send flow owns. */
      mint: string;
      onChooseToken: () => void;
    })
  | (StepProps & { mode: "bank"; recipient: BankRecipient | null });

type AmountStatus = "idle" | "ready" | "error";

export default function AmountStep(props: AmountStepProps) {
  if (props.mode === "crypto") return <CryptoAmountStep {...props} />;
  return props.recipient ? (
    <BankAmountStep {...props} recipient={props.recipient} />
  ) : (
    <View className="flex-1" />
  );
}

/** Shown before the balance loads, and when no dollars are held. */
function emptyUsdc(): HeldSwapToken {
  return {
    mint: getUsdcMint(),
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    iconUrl: null,
    amountRaw: "0",
    usdPrice: 1,
  };
}

function CryptoAmountStep({
  recipient,
  mint,
  onChooseToken,
  onBack,
  onClose,
}: StepProps & {
  recipient: string;
  mint: string;
  onChooseToken: () => void;
}) {
  const { sendCrypto } = useSendExecutor();
  const { tokens } = useBalances();
  const palette = usePalette();
  const held = useMemo(() => heldSwapTokens(tokens), [tokens]);

  const token =
    held.find((candidate) => candidate.mint === mint) ??
    held.find((candidate) => candidate.mint === getUsdcMint()) ??
    emptyUsdc();
  const isDollars = token.mint === getUsdcMint();
  const sendableRaw =
    tokens.find((balance) => balance.mint === token.mint)?.nativeAmountRaw ??
    token.amountRaw;
  const heldRaw = BigInt(sendableRaw);
  const price = isDollars ? 1 : token.usdPrice;
  const worthOf =
    price === null
      ? undefined
      : (amount: string) =>
          amount ? formatUsdFromString(String(Number(amount) * price)) : "$0";

  return (
    <AmountPad
      // A new token starts from an empty amount: digits typed for one
      // token mean something else in another.
      key={token.mint}
      recipientLabel={truncateAddress(recipient)}
      maxDecimals={token.decimals}
      // Fixed while a send is being prepared: a new token would remount the
      // pad and let a second send start beside the one being signed.
      chip={(busy) => (
        <HapticPressable
          onPress={onChooseToken}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Sending ${token.symbol}. Change token`}
          accessibilityState={{ disabled: busy }}
          className="flex-row items-center gap-1.5 rounded-full bg-white py-1.5 pl-1.5 pr-3 shadow-sm dark:bg-foreground/10"
        >
          <TokenMark
            mint={token.mint}
            label={token.symbol}
            iconUrl={token.iconUrl}
            size={22}
          />
          <Typography weight="700" className="text-foreground">
            {token.symbol}
          </Typography>
          <Ionicons name="chevron-down" size={12} color={palette.foreground} />
        </HapticPressable>
      )}
      balanceLabel={`${heldLabel(sendableRaw, token.decimals, isDollars)} ${token.symbol}`}
      maxAmount={toAmountInput(sendableRaw, token.decimals)}
      worthOf={worthOf}
      statusOf={(amount) => {
        const raw = BigInt(toRawAmount(amount, token.decimals));
        if (raw === 0n) return "idle";
        return raw <= heldRaw ? "ready" : "error";
      }}
      onBack={onBack}
      onContinue={(amount) =>
        sendCrypto(
          recipient,
          amount,
          { mint: token.mint, decimals: token.decimals },
          {
            flow: trackFlow("send", {
              rail: "wallet",
              token: token.symbol,
              amount_bucket:
                price === null
                  ? undefined
                  : bucketAmount(Number(amount) * price),
            }),
          }
        )
      }
      onSending={onClose}
    />
  );
}

/** A balance as the pill shows it: dollars to the cent, other tokens cut short. */
function heldLabel(
  amountRaw: string,
  decimals: number,
  isDollars: boolean
): string {
  if (!isDollars) return formatRawAmountShort(amountRaw, decimals);
  const [whole, fraction = ""] = formatRawAmountShort(
    amountRaw,
    decimals,
    2
  ).split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

function BankAmountStep({
  recipient,
  onBack,
  onClose,
}: StepProps & { recipient: BankRecipient }) {
  const router = useRouter();
  const palette = usePalette();
  const { prepareBank, fundBank } = useSendExecutor();
  const { usdc, portfolio } = useBalances();
  const { balance: earnBalance } = useEarnPosition();
  const limits = useQuery({
    queryKey: ["fiat", "limits"],
    queryFn: () => apiClient.fiatLimits(),
  });
  const [review, setReview] = useState<FiatOrder | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [writingNote, setWritingNote] = useState(false);

  const minor = fiatAmountMinor(amount.replace(/\.$/, ""), 2);
  const [debounced, setDebounced] = useState<string | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(minor), 450);
    return () => clearTimeout(id);
  }, [minor]);

  const kobo = minor ? BigInt(minor) : 0n;
  const quote = useQuery({
    queryKey: ["fiat", "quote", BANK_SEND_ROUTE, "credit", debounced],
    queryFn: () => apiClient.fiatQuote(BANK_SEND_ROUTE, debounced!, "credit"),
    enabled: debounced !== null && BigInt(debounced) >= MIN_PAYOUT_KOBO,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });

  const verified = limits.data?.verified === true;
  const left =
    limits.data && !verified ? nairaAllowanceLeft(limits.data, "send") : null;
  const tooSmall = kobo > 0n && kobo < MIN_PAYOUT_KOBO;
  const overLimit = left !== null && kobo > left;
  const usdcMinor = BigInt(Math.floor(usdc * 1_000_000));
  const priced =
    quote.data && debounced === minor && !tooSmall ? quote.data : null;
  const short = priced ? BigInt(priced.debit.amountMinor) > usdcMinor : false;
  const ready = kobo >= MIN_PAYOUT_KOBO && !short;
  const naira = displayMoney("NGN", (minor ?? "0").toString());
  const cashLabel = usdcAsDollars(usdcMinor, "down");
  // Home's headline also counts investments and Earn; only cash can be paid
  // out to a bank, so say why the two numbers differ.
  const elsewhere =
    earnBalance !== null &&
    portfolio.cashUsd + portfolio.investmentsUsd + earnBalance - usdc >= 0.01;

  const openVerify = () => {
    // The sheet sits above every screen, so it closes before the page opens.
    onClose();
    router.push("/verify-identity");
  };

  const handleKeyPress = (key: string) => {
    if (busy) return;
    setFailure(null);
    setAmount((prev) => {
      if (key === "backspace") return prev.slice(0, -1);
      if (key === ".") return prev.includes(".") ? prev : (prev || "0") + ".";
      const [, fraction] = prev.split(".");
      if (fraction !== undefined && fraction.length >= 2) return prev;
      if (prev === "0") return key;
      const next = prev + key;
      return next.replace(".", "").length > 11 ? prev : next;
    });
  };

  const handleContinue = async () => {
    Keyboard.dismiss();
    setWritingNote(false);
    if (busy || !ready || !minor) return;
    if (overLimit) {
      openVerify();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const prepared = await prepareBank(recipient, minor, note);
      if (prepared.status === "review") setReview(prepared.order);
      else if (prepared.status === "verify") openVerify();
      else if (prepared.status === "failed") setFailure(prepared.reason);
    } catch {
      setFailure("Something went wrong. Nothing has been sent.");
    } finally {
      setBusy(false);
    }
  };

  const formatted = useMemo(() => {
    if (!amount) return "₦0";
    const [whole, fraction] = amount.split(".");
    const grouped = formatAmount({
      amount: whole || "0",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    return `₦${grouped}${fraction !== undefined ? `.${fraction}` : ""}`;
  }, [amount]);

  const insets = useSafeAreaInsets();

  if (review) {
    return (
      <BankReview
        order={review}
        recipient={recipient}
        note={note.trim()}
        balanceMinor={usdcMinor}
        onBack={() => setReview(null)}
        onConfirm={() => fundBank(review)}
        onSending={onClose}
      />
    );
  }

  // One line under the amount: what it costs before the fee, or what is wrong.
  const helper: { text: string; tone: "muted" | "error" } = failure
    ? { text: failure, tone: "error" }
    : tooSmall
      ? { text: "The smallest bank transfer is ₦1,000.", tone: "error" }
      : short
        ? {
            text: elsewhere
              ? `More than your ${cashLabel} in cash. Earn and investments can't go to a bank.`
              : `More than your ${cashLabel}.`,
            tone: "error",
          }
        : overLimit && left !== null
          ? {
              text: `Over the ${displayMoney("NGN", left.toString())} you can send today without verifying.`,
              tone: "error",
            }
          : kobo >= MIN_PAYOUT_KOBO
            ? {
                text: priced
                  ? `About ${usdcAsDollars(priced.debit.amountMinor, "nearest")} plus a small fee`
                  : "Checking the rate…",
                tone: "muted",
              }
            : { text: "", tone: "muted" };

  return (
    <Pressable accessible={false} onPress={Keyboard.dismiss} className="flex-1">
      <BankSheetTop leave="back" onPress={onBack} disabled={busy} />
      <View className="flex-row items-center justify-center gap-3 px-5">
        <BankLogo name={recipient.bankName} logoKey={recipient.logoKey} />
        <View className="shrink">
          <Typography
            weight="600"
            numberOfLines={1}
            className="text-[15px] text-ink"
          >
            {recipient.accountName}
          </Typography>
          <Typography
            weight="500"
            numberOfLines={1}
            className="text-[13px] tabular-nums text-foreground/55"
          >
            {`${recipient.bankName} · ${groupAccountNumber(recipient.accountNumber)}`}
          </Typography>
        </View>
      </View>

      <View
        className={cn(
          "flex-1 items-center px-5",
          writingNote ? "justify-start pt-8" : "justify-center"
        )}
      >
        <Typography
          accessibilityLabel={`Amount ${naira}`}
          numberOfLines={1}
          className={cn(
            "text-center",
            displayStep(formatted, "lg"),
            amount ? "text-ink" : "text-foreground/20"
          )}
          style={DISPLAY}
        >
          {formatted}
        </Typography>
        <Typography
          weight="500"
          className={cn(
            "mt-1 min-h-5 text-center text-[14px] tabular-nums",
            helper.tone === "error" ? "text-destructive" : "text-foreground/55"
          )}
        >
          {helper.text}
        </Typography>

        <View className="mt-5 h-11 w-full flex-row items-center gap-2 rounded-full bg-foreground/[0.04] px-4">
          <Image
            source={require("@/assets/icons/support.png")}
            style={{ width: 16, height: 16 }}
            tintColor={palette.fg(0.75)}
            contentFit="contain"
            accessibilityElementsHidden
          />
          <BottomSheetTextInput
            className="flex-1 py-0 font-inter-medium text-[15px] tracking-normal text-ink"
            placeholder={`Note for ${recipient.accountName.split(" ")[0]} (optional)`}
            placeholderTextColor={palette.fg(0.55)}
            keyboardAppearance={palette.dark ? "dark" : "light"}
            value={note}
            onChangeText={(text) => setNote(text.slice(0, NOTE_MAX))}
            onFocus={() => setWritingNote(true)}
            onBlur={() => setWritingNote(false)}
            returnKeyType="done"
            maxLength={NOTE_MAX}
            accessibilityLabel="Note, shown on the recipient's bank alert"
          />
        </View>
      </View>

      <View className="mx-5 mb-1 flex-row items-center justify-between rounded-full bg-foreground/[0.04] py-2 pl-2 pr-4">
        <View className="flex-row items-center gap-1.5 rounded-full bg-white py-1 pl-1.5 pr-3 dark:bg-foreground/10">
          <Typography className="text-[15px]">🇳🇬</Typography>
          <Typography weight="600" className="text-[14px] text-ink">
            NGN
          </Typography>
        </View>
        <Typography
          weight="500"
          className="text-[13px] tabular-nums text-foreground/55"
        >
          {left !== null
            ? `${displayMoney("NGN", left.toString())} left today · ${cashLabel}`
            : `${cashLabel} available`}
        </Typography>
      </View>

      {writingNote ? null : (
        <View className="px-3">
          <Keypad onKeyPress={handleKeyPress} />
        </View>
      )}
      <View className="px-5 pt-1" style={{ paddingBottom: insets.bottom + 8 }}>
        <PillButton
          title={overLimit ? `Verify to send ${naira}` : "Review"}
          disabled={!ready}
          loading={busy}
          onPress={() => void handleContinue()}
        />
      </View>
    </Pressable>
  );
}

// Nigerian banks cut narrations short; the backend trims to the same length.
const NOTE_MAX = 60;

const MIN_PAYOUT_KOBO = 100_000n;

/**
 * Montserrat Black naira amounts in fixed steps by length. iOS auto-fit text
 * collapses to a sliver inside a centred column, so the size is chosen here.
 */
function displayStep(text: string, scale: "lg" | "md") {
  const long = text.length > 10;
  const longer = text.length > 13;
  if (scale === "lg")
    return longer
      ? "text-[38px] leading-[46px]"
      : long
        ? "text-[46px] leading-[56px]"
        : "text-[56px] leading-[66px]";
  return longer
    ? "text-[30px] leading-[38px]"
    : long
      ? "text-[36px] leading-[44px]"
      : "text-[44px] leading-[52px]";
}

function feeLabel(feeMinor: bigint): string {
  if (feeMinor === 0n) return "No fee";
  return feeMinor < 5_000n ? "Under $0.01" : usdcAsDollars(feeMinor, "nearest");
}

/**
 * The last look before money moves: what the recipient gets, what leaves the
 * Account (fee included, as the payout partner priced it) and what the fee is.
 * The exact micro-dollar deposit is sent as is; only its display is rounded.
 */
function BankReview({
  order,
  recipient,
  note,
  balanceMinor,
  onBack,
  onConfirm,
  onSending,
}: {
  order: FiatOrder;
  recipient: BankRecipient;
  note: string;
  balanceMinor: bigint;
  onBack: () => void;
  onConfirm: () => Promise<SendStart>;
  onSending: () => void;
}) {
  const palette = usePalette();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const deposit = order.instructions.depositAmount!;
  const depositMinor = BigInt(deposit.amountMinor);
  const quotedMinor = BigInt(order.quote.debit.amountMinor);
  const feeMinor = depositMinor > quotedMinor ? depositMinor - quotedMinor : 0n;
  const naira = displayMoney("NGN", order.quote.credit.amountMinor);
  const short = depositMinor > balanceMinor;
  const dollars = usdcAsDollars(depositMinor, "nearest");
  const firstName = recipient.accountName.split(" ")[0];
  // Kobo per whole USDC, so it prints as naira with displayMoney.
  const rateKobo =
    quotedMinor > 0n
      ? (BigInt(order.quote.credit.amountMinor) * 1_000_000n +
          quotedMinor / 2n) /
        quotedMinor
      : 0n;

  const confirm = async () => {
    if (busy || short) return;
    setBusy(true);
    setFailure(null);
    let start: SendStart;
    try {
      start = await onConfirm();
    } catch {
      start = {
        status: "failed",
        reason: "Something went wrong. Nothing has been sent.",
      };
    }
    if (start.status === "sending") {
      onSending();
      return;
    }
    setBusy(false);
    if (start.status === "failed") setFailure(start.reason);
  };

  return (
    <View className="flex-1">
      <BankSheetTop leave="back" onPress={onBack} disabled={busy} />
      <View className="flex-1 items-center justify-center px-6 pb-10">
        <BankLogo
          name={recipient.bankName}
          logoKey={recipient.logoKey}
          size="lg"
        />
        <Typography
          weight="600"
          numberOfLines={1}
          className="mt-3 text-[16px] text-ink"
        >
          {recipient.accountName}
        </Typography>
        <Typography
          weight="500"
          numberOfLines={1}
          className="mt-0.5 text-[13px] tabular-nums text-foreground/55"
        >
          {`${recipient.bankName} · ${groupAccountNumber(recipient.accountNumber)}`}
        </Typography>

        <Typography
          accessibilityRole="header"
          accessibilityLabel={`${firstName} gets ${naira}`}
          numberOfLines={1}
          className={cn("mt-8 text-ink", displayStep(naira, "lg"))}
          style={DISPLAY}
        >
          {naira}
        </Typography>

        {note ? (
          <View className="mt-6 max-w-full flex-row items-center gap-2 rounded-full bg-foreground/[0.04] py-2 pl-3 pr-4">
            <Image
              source={require("@/assets/icons/support.png")}
              style={{ width: 14, height: 14 }}
              tintColor={palette.fg(0.75)}
              contentFit="contain"
              accessibilityElementsHidden
            />
            <Typography
              weight="500"
              numberOfLines={2}
              className="shrink text-[14px] text-ink"
            >
              {note}
            </Typography>
          </View>
        ) : null}

        <View className="mt-10 w-full gap-3.5 rounded-3xl bg-foreground/[0.03] px-5 py-5">
          <ReviewRow label="From your Account" value={dollars} strong />
          <ReviewRow label="Fee, included" value={feeLabel(feeMinor)} />
          <ReviewRow
            label="Rate"
            value={`$1 = ${displayMoney("NGN", rateKobo.toString())}`}
          />
          <ReviewRow label="Arrives" value="Usually within minutes" />
        </View>
      </View>

      <BankSheetFooter>
        {failure || short ? (
          <Footnote tone="error" className="pb-3 text-center">
            {failure ?? "You don't have enough in your Account for this."}
          </Footnote>
        ) : null}
        <PillButton
          title={`Send ${naira}`}
          disabled={short}
          loading={busy}
          onPress={() => void confirm()}
        />
      </BankSheetFooter>
    </View>
  );
}

function ReviewRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between gap-4">
      <Typography weight="500" className="text-[15px] text-foreground/55">
        {label}
      </Typography>
      <Typography
        weight={strong ? "700" : "600"}
        numberOfLines={1}
        className="shrink text-right text-[15px] tabular-nums text-ink"
      >
        {value}
      </Typography>
    </View>
  );
}

interface AmountPadProps {
  recipientLabel: string;
  recipientDetail?: string;
  prefix?: string;
  maxDecimals: number;
  /** A function when the chip has to stand still while a send is under way. */
  chip: React.ReactNode | ((busy: boolean) => React.ReactNode);
  balanceLabel: string;
  /** Absent when no exact maximum exists, which hides MAX. */
  maxAmount?: string;
  statusOf: (amount: string) => AmountStatus;
  noteFor?: (amount: string) => string | null;
  /** The amount in dollars, under the number. Absent when it cannot be priced. */
  worthOf?: (amount: string) => string;
  onBack: () => void;
  onContinue: (amount: string) => Promise<SendStart>;
  onSending: () => void;
}

function AmountPad({
  recipientLabel,
  recipientDetail,
  prefix = "",
  maxDecimals,
  chip,
  balanceLabel,
  maxAmount,
  statusOf,
  noteFor,
  worthOf,
  onBack,
  onContinue,
  onSending,
}: AmountPadProps) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const note = failure ?? noteFor?.(amount) ?? null;

  const handleKeyPress = (key: string) => {
    if (busy) return;
    setFailure(null);
    if (key === "backspace") {
      setAmount((prev) => (prev.length > 1 ? prev.slice(0, -1) : ""));
    } else if (key === ".") {
      if (!amount) {
        setAmount("0.");
        return;
      }
      if (!amount.includes(".")) setAmount((prev) => prev + ".");
    } else {
      if (amount === "0") setAmount(key);
      else {
        const parts = amount.split(".");
        if (parts.length > 1 && parts[1].length >= maxDecimals) return;
        setAmount((prev) => prev + key);
      }
    }
  };

  const handleContinue = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    let start: SendStart;
    try {
      start = await onContinue(amount);
    } catch {
      start = {
        status: "failed",
        reason: "Something went wrong. Nothing has been sent.",
      };
    }
    // Left busy on the way out so the button does not flash back to Continue
    // while the sheet closes.
    if (start.status === "sending") {
      onSending();
      return;
    }
    setBusy(false);
    if (start.status === "failed") setFailure(start.reason);
  };

  const status = statusOf(amount);
  const label = status === "error" ? "Insufficient balance" : "Continue";

  const formattedAmount = useMemo(() => {
    if (amount === "") return `${prefix}0`;
    // if (amount === '0.') return amount;
    if (amount.endsWith(".")) {
      const [int] = amount.split(".");
      return (
        prefix +
        formatAmount({
          amount: int,
          minimumFractionDigits: 0,
          maximumFractionDigits: maxDecimals,
        }) +
        "."
      );
    }
    return (
      prefix +
      formatAmount({
        amount,
        minimumFractionDigits: 0,
        maximumFractionDigits: maxDecimals,
      })
    );
  }, [amount, prefix, maxDecimals]);

  return (
    <View className="flex-1">
      <View className="relative mb-6 flex-1 px-4">
        {/* Header */}
        <View className="mb-4 flex-row items-center justify-between">
          <TouchableOpacity
            onPress={onBack}
            disabled={busy}
            className="h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-muted"
          >
            <Ionicons name="chevron-back" size={24} color="#999" />
          </TouchableOpacity>
          <View className="items-center">
            <Typography weight="700" className="text-lg text-foreground">
              Enter amount
            </Typography>
            <Typography className="text-sm text-gray-400">
              To: {recipientLabel}
            </Typography>
            {recipientDetail ? (
              <Typography className="text-xs text-gray-400">
                {recipientDetail}
              </Typography>
            ) : null}
          </View>
          <View className="h-10 w-10" />
        </View>

        {/* Amount Display */}
        <View className="-mt-10 flex-1 items-center justify-center">
          <Typography
            weight="700"
            className={cn(
              "text-7xl tracking-tight",
              !amount
                ? "text-gray-300 dark:text-foreground/20"
                : "text-foreground"
            )}
          >
            {formattedAmount}
          </Typography>
          {worthOf ? (
            <Typography weight="500" className="mt-2 text-lg text-gray-400">
              {worthOf(amount)}
            </Typography>
          ) : null}

          {/* Swap Icon Button */}
          {/* <TouchableOpacity className="absolute right-0 top-1/2 mt-4 w-10 h-10 bg-white rounded-full items-center justify-center border border-gray-100 shadow-sm">
                        <Ionicons name="swap-vertical" size={20} color="black" />
                    </TouchableOpacity> */}
        </View>

        {/* Token Selector & Max */}
        <View className="mx-6 mb-8 flex-row items-center justify-between rounded-full bg-[#F9F9F9] p-2 dark:bg-muted">
          {typeof chip === "function" ? chip(busy) : chip}

          <Typography weight="500" className="ml-3 flex-1 text-gray-400">
            {balanceLabel}
          </Typography>

          {maxAmount !== undefined ? (
            <TouchableOpacity
              className="rounded-full bg-primary px-4 py-1.5"
              onPress={() => {
                if (busy) return;
                setFailure(null);
                setAmount(maxAmount);
              }}
            >
              <Typography
                weight="700"
                className="text-xs text-primary-foreground"
              >
                MAX
              </Typography>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Keypad */}
        <View className="mb-2">
          <Keypad onKeyPress={handleKeyPress} />
        </View>

        {/* Height held whether or not there is a note, so crossing the limit
            does not shift the button out from under a thumb already moving. */}
        <View className="min-h-5 justify-center pb-2">
          {note && (
            <Typography
              weight="500"
              className={cn(
                "text-center text-sm",
                failure
                  ? "text-destructive"
                  : "text-gray-500 dark:text-foreground/55"
              )}
            >
              {note}
            </Typography>
          )}
        </View>

        <HapticPressable
          className={cn(
            "mb-2 w-full items-center rounded-full bg-primary py-4",
            {
              "opacity-70": status === "idle",
              "opacity-100": status === "ready",
              "bg-red-500/30": status === "error",
            }
          )}
          onPress={handleContinue}
          disabled={busy || status === "error" || status === "idle"}
        >
          {busy ? (
            <ActivityIndicator
              size="small"
              className="text-primary-foreground"
            />
          ) : (
            <Typography
              weight="500"
              className={cn(
                "text-base text-primary-foreground",
                status === "error" && "text-red-500"
              )}
            >
              {label}
            </Typography>
          )}
        </HapticPressable>
      </View>
    </View>
  );
}
