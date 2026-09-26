import React, { useMemo, useState } from "react";
import { View, TouchableOpacity, ActivityIndicator } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import { Keypad } from "@/components/ui/molecules";
import { Ionicons } from "@expo/vector-icons";
import { formatAmount, truncateAddress } from "@/utils/helper";
import { useBalances } from "@/hooks/useBalances";
import HapticPressable from "../../atoms/HapticPressable";
import { cn } from "@/utils/cn";
import { useAccount } from "@/hooks/useAccount";
import { describeSecondCheck, SECOND_CHECK_NOTE } from "@/utils/spendingLimit";
import { useUnifiedFiat } from "@/hooks/useUnifiedFiat";
import { displayMoney } from "@/utils/display-money";
import { fiatAmountMinor } from "@/utils/fiat";
import { useSendExecutor, type SendStart } from "@/hooks/useSendExecutor";
import { groupAccountNumber, type BankRecipient } from "./bankAccount";

interface StepProps {
  onBack: () => void;
  onClose: () => void;
}

type AmountStepProps =
  | (StepProps & { mode: "crypto"; recipient: string })
  | (StepProps & { mode: "bank"; recipient: BankRecipient | null });

type AmountStatus = "idle" | "ready" | "error";

export default function AmountStep(props: AmountStepProps) {
  if (props.mode === "crypto") return <CryptoAmountStep {...props} />;
  return props.recipient ? (
    <BankAmountStep {...props} recipient={props.recipient} />
  ) : (
    <View className="flex-1 bg-[#F0F0F0]" />
  );
}

function CryptoAmountStep({
  recipient,
  onBack,
  onClose,
}: StepProps & { recipient: string }) {
  const { data: account } = useAccount();
  const { sendCrypto } = useSendExecutor();
  const { total } = useBalances();
  const balance = total ?? 0;

  return (
    <AmountPad
      recipientLabel={truncateAddress(recipient)}
      maxDecimals={8}
      chip={
        <TouchableOpacity className="flex-row items-center rounded-full bg-white px-3 py-1.5 shadow-sm">
          <View className="mr-2 h-5 w-5 items-center justify-center rounded-full bg-blue-500">
            <Ionicons name="logo-usd" size={12} color="white" />
          </View>
          <Typography weight="700" className="mr-1">
            USDC
          </Typography>
          <Ionicons name="chevron-down" size={12} color="black" />
        </TouchableOpacity>
      }
      balanceLabel={`${balance ? balance.toFixed(2) : "0.00"} USDC`}
      maxAmount={balance.toString()}
      statusOf={(amount) => {
        if (Number(amount) > 0 && Number(amount) <= Number(balance))
          return "ready";
        if (amount && Number(amount) > Number(balance)) return "error";
        return "idle";
      }}
      noteFor={(amount) => {
        const secondCheck = describeSecondCheck(account, amount);
        return secondCheck ? SECOND_CHECK_NOTE[secondCheck.reason] : null;
      }}
      onBack={onBack}
      onContinue={(amount) => sendCrypto(recipient, amount)}
      onSending={onClose}
    />
  );
}

function BankAmountStep({
  recipient,
  onBack,
  onClose,
}: StepProps & { recipient: BankRecipient }) {
  const { data } = useUnifiedFiat("NGN");
  const { sendBank } = useSendExecutor();
  const availableMinor = data?.total.availableMinor;

  return (
    <AmountPad
      recipientLabel={recipient.accountName}
      recipientDetail={`${groupAccountNumber(recipient.accountNumber)} · ${recipient.bankName}`}
      prefix="₦"
      maxDecimals={2}
      chip={
        <View className="flex-row items-center rounded-full bg-white px-3 py-1.5 shadow-sm">
          <View className="mr-2 h-5 w-5 items-center justify-center rounded-full bg-black">
            <Typography weight="700" className="text-[11px] text-white">
              ₦
            </Typography>
          </View>
          <Typography weight="700">NGN</Typography>
        </View>
      }
      balanceLabel={
        availableMinor === undefined
          ? "Checking balance"
          : `${displayMoney("NGN", availableMinor)} available`
      }
      maxAmount={
        availableMinor === undefined ? "" : minorToInput(availableMinor)
      }
      statusOf={(amount) => {
        const minor = fiatAmountMinor(amount, 2);
        if (!minor || availableMinor === undefined) return "idle";
        return BigInt(minor) > BigInt(availableMinor) ? "error" : "ready";
      }}
      onBack={onBack}
      onContinue={async (amount) => {
        const minor = fiatAmountMinor(amount, 2);
        if (!minor)
          return { status: "failed", reason: "This amount is not valid." };
        return sendBank(recipient, minor);
      }}
      onSending={onClose}
    />
  );
}

function minorToInput(minor: string): string {
  const digits = minor.padStart(3, "0");
  const whole = digits.slice(0, -2).replace(/^0+(?=\d)/, "");
  const fraction = digits.slice(-2).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

interface AmountPadProps {
  recipientLabel: string;
  recipientDetail?: string;
  prefix?: string;
  maxDecimals: number;
  chip: React.ReactNode;
  balanceLabel: string;
  maxAmount: string;
  statusOf: (amount: string) => AmountStatus;
  noteFor?: (amount: string) => string | null;
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
    <View className="flex-1 bg-[#F0F0F0]">
      <View className="relative mb-6 flex-1 px-4">
        {/* Header */}
        <View className="mb-4 flex-row items-center justify-between">
          <TouchableOpacity
            onPress={onBack}
            disabled={busy}
            className="h-10 w-10 items-center justify-center rounded-full bg-gray-100"
          >
            <Ionicons name="chevron-back" size={24} color="#999" />
          </TouchableOpacity>
          <View className="items-center">
            <Typography weight="700" className="text-lg">
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
              !amount ? "text-gray-300" : "text-black"
            )}
          >
            {formattedAmount}
          </Typography>
          {/* <View className="flex-row items-center mt-2">
                        <Text className="text-gray-400 text-lg font-medium mr-1">$0</Text>
                    </View> */}

          {/* Swap Icon Button */}
          {/* <TouchableOpacity className="absolute right-0 top-1/2 mt-4 w-10 h-10 bg-white rounded-full items-center justify-center border border-gray-100 shadow-sm">
                        <Ionicons name="swap-vertical" size={20} color="black" />
                    </TouchableOpacity> */}
        </View>

        {/* Token Selector & Max */}
        <View className="mx-6 mb-8 flex-row items-center justify-between rounded-full bg-[#F9F9F9] p-2">
          {chip}

          <Typography weight="500" className="ml-3 flex-1 text-gray-400">
            {balanceLabel}
          </Typography>

          <TouchableOpacity
            className="rounded-full bg-black px-4 py-1.5"
            onPress={() => {
              if (busy) return;
              setFailure(null);
              setAmount(maxAmount);
            }}
          >
            <Typography weight="700" className="text-xs text-white">
              MAX
            </Typography>
          </TouchableOpacity>
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
                failure ? "text-destructive" : "text-gray-500"
              )}
            >
              {note}
            </Typography>
          )}
        </View>

        <HapticPressable
          className={cn("mb-2 w-full items-center rounded-full bg-black py-4", {
            "opacity-70": status === "idle",
            "opacity-100": status === "ready",
            "bg-red-500/30": status === "error",
          })}
          onPress={handleContinue}
          disabled={busy || status === "error" || status === "idle"}
        >
          {busy ? (
            <ActivityIndicator size="small" className="text-white" />
          ) : (
            <Typography
              weight="500"
              className={cn(
                "text-base text-white",
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
