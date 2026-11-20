import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { TextInput } from "react-native-gesture-handler";
import { useQuery } from "@tanstack/react-query";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { PillButton } from "@/components/ui/kit";
import { Illustration } from "@/components/ui/feature/Illustration";
import { useUnifiedFiat } from "@/hooks/useUnifiedFiat";
import { apiClient, apiErrorMessage, apiErrorStatus } from "@/utils/apiClient";
import { BankAccountNotFoundError, type Bank } from "@/utils/bank-directory";
import { cn } from "@/utils/cn";
import {
  ACCOUNT_NUMBER_LENGTH,
  type BankRecipient,
  decodeBankDestination,
  extractAccountNumber,
  groupAccountNumber,
  isAccountNumber,
} from "./bankAccount";
import { BankLogo } from "./BankLogo";
import { BankSearchSheet } from "./BankSearchSheet";
import {
  BANK_SHEET_BG,
  BankSheetFooter,
  BankSheetTop,
  DISPLAY,
} from "./BankSheetParts";

interface BankRecipientStepProps {
  onNext: (recipient: BankRecipient) => void;
  onClose: () => void;
  recipient?: string;
  setRecipient?: (recipient: string) => void;
}

type Check =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "found"; recipient: BankRecipient }
  | { state: "failed"; message: string };

type RecentAccount = {
  accountNumber: string;
  bankCode: string | null;
  sends: number;
};

const BANK_LIST_STALE_MS = 6 * 60 * 60 * 1000;

function resolveFailure(error: unknown, bankName: string): string {
  if (error instanceof BankAccountNotFoundError)
    return `No account with this number at ${bankName}. Check the number or pick another bank.`;
  if (apiErrorStatus(error) === 429)
    return (
      apiErrorMessage(error) ??
      "Too many account checks. Try again in a few minutes."
    );
  return `We couldn't reach ${bankName} right now. Try again or pick another bank.`;
}

/**
 * The shared Divider reads the screen theme, which the send sheet's portal
 * does not provide. iOS only dashes a full border, so one edge of it shows.
 */
function DashedRule() {
  return (
    <View className="my-4 h-px overflow-hidden">
      <View className="h-[3px] border border-dashed border-black/20" />
    </View>
  );
}

/** A short bank name for a suggestion chip. */
function shortBankName(name: string) {
  // "Paycom (Opay)": the brand people know is the one in brackets.
  const brand = name.match(/\(([^)]+)\)/)?.[1];
  return (brand ?? name)
    .replace(/\(.*?\)/g, "")
    .replace(/\b(Microfinance Bank|MFB|Bank of Nigeria|Plc|Limited)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Who the money goes to, on one page: the account number, then its bank (a
 * suggestion from the number, or a search), then the name the bank holds.
 */
export default function BankRecipientStep({
  onNext,
  onClose,
  recipient,
  setRecipient,
}: BankRecipientStepProps) {
  const inputRef = useRef<TextInput | null>(null);
  const searchRef = useRef<BottomSheetModal>(null);
  const [localNumber, setLocalNumber] = useState(recipient ?? "");
  const accountNumber = recipient ?? localNumber;
  const setAccountNumber = setRecipient ?? setLocalNumber;
  const [bank, setBank] = useState<Bank | null>(null);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const checkId = useRef(0);
  const isComplete = isAccountNumber(accountNumber);

  const { data } = useUnifiedFiat("NGN");
  // Payout banks are the payout partner's list, so a picked code is the one
  // the payout order carries.
  const banksQuery = useQuery({
    queryKey: ["fiat", "payout-banks"],
    queryFn: () => apiClient.payoutBanks(),
    staleTime: BANK_LIST_STALE_MS,
    gcTime: BANK_LIST_STALE_MS,
  });
  const candidatesQuery = useQuery({
    queryKey: ["fiat", "payout-banks", "candidates", accountNumber],
    queryFn: () => apiClient.payoutBankCandidates(accountNumber),
    enabled: isComplete,
    staleTime: BANK_LIST_STALE_MS,
  });

  const banksByCode = useMemo(
    () => new Map((banksQuery.data ?? []).map((b) => [b.code, b])),
    [banksQuery.data]
  );

  const recentAccounts = useMemo<RecentAccount[]>(() => {
    const byNewest = [...(data?.orders ?? [])]
      .filter((order) => order.plan.destinationCurrency === "NGN")
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const accounts = new Map<string, RecentAccount>();
    for (const order of byNewest) {
      const decoded = decodeBankDestination(order.destination);
      if (!decoded) continue;
      const key = `${decoded.bankCode ?? ""}:${decoded.accountNumber}`;
      const seen = accounts.get(key);
      if (seen) seen.sends += 1;
      else accounts.set(key, { ...decoded, sends: 1 });
    }
    return [...accounts.values()];
  }, [data?.orders]);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, []);

  const lookUp = async (number: string, picked: Bank) => {
    Keyboard.dismiss();
    const id = ++checkId.current;
    setBank(picked);
    setCheck({ state: "checking" });
    try {
      const { accountName } = await apiClient.payoutAccountLookup(
        picked.code,
        number
      );
      if (id !== checkId.current) return;
      setCheck({
        state: "found",
        recipient: {
          accountNumber: number,
          bankCode: picked.code,
          bankName: picked.name,
          accountName: accountName ?? "Account holder",
          logoKey: picked.logoKey ?? null,
        },
      });
    } catch (error) {
      if (id !== checkId.current) return;
      setCheck({
        state: "failed",
        message: resolveFailure(error, picked.name),
      });
    }
  };

  const resetBank = () => {
    checkId.current += 1;
    setBank(null);
    setCheck({ state: "idle" });
  };

  const changeNumber = (next: string) => {
    if (next !== accountNumber) resetBank();
    setAccountNumber(next);
    if (isAccountNumber(next)) Keyboard.dismiss();
  };

  const handlePaste = async () => {
    const text = await Clipboard.getStringAsync();
    const pasted = text ? extractAccountNumber(text) : null;
    if (pasted) changeNumber(pasted);
  };

  const openSearch = () => {
    Keyboard.dismiss();
    searchRef.current?.present();
  };

  const pickFromSearch = (picked: Bank) => {
    searchRef.current?.dismiss();
    void lookUp(accountNumber, picked);
  };

  const openRecent = (account: RecentAccount) => {
    changeNumber(account.accountNumber);
    const known = account.bankCode ? banksByCode.get(account.bankCode) : null;
    if (known) void lookUp(account.accountNumber, known);
  };

  const suggestions = (candidatesQuery.data ?? []).slice(0, 4);
  const found = check.state === "found" ? check.recipient : null;

  return (
    <View className="flex-1" style={{ backgroundColor: BANK_SHEET_BG }}>
      <BankSheetTop leave="close" onPress={onClose} />
      <BottomSheetScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="px-5 pb-10"
      >
        <View className="h-[104px] justify-center overflow-hidden rounded-[24px] bg-[#F2F2F0] px-5">
          <Typography
            accessibilityRole="header"
            className="max-w-[210px] text-[24px] uppercase leading-[26px] tracking-[-0.6px] text-[#0E0F0C]"
            style={DISPLAY}
          >
            Send to a bank
          </Typography>
          <Typography
            weight="500"
            className="mt-1.5 max-w-[200px] text-[13px] leading-[18px] text-black/55"
          >
            Naira to any Nigerian account.
          </Typography>
          <View className="absolute -bottom-4 right-0">
            <Illustration name="deposit" size={112} />
          </View>
        </View>

        <View className="mt-5 rounded-[24px] border border-black/[0.08] bg-white px-5 py-4">
          <Typography weight="500" className="text-[13px] text-black/55">
            Account number
          </Typography>
          <View className="mt-1 flex-row items-center">
            <BottomSheetTextInput
              ref={inputRef}
              className="flex-1 py-1 font-inter-medium text-[22px] tabular-nums tracking-[1.5px] text-[#0E0F0C]"
              placeholder="0000000000"
              placeholderTextColor="#00000040"
              value={accountNumber}
              onChangeText={(text) =>
                changeNumber(
                  text.replace(/\D/g, "").slice(0, ACCOUNT_NUMBER_LENGTH)
                )
              }
              keyboardType="number-pad"
              maxLength={ACCOUNT_NUMBER_LENGTH}
              autoCorrect={false}
              accessibilityLabel="Account number"
            />
            {accountNumber ? (
              <HapticPressable
                accessibilityRole="button"
                accessibilityLabel="Clear account number"
                className="size-10 items-center justify-center"
                onPress={() => {
                  changeNumber("");
                  inputRef.current?.focus();
                }}
              >
                <Ionicons name="close-circle" size={20} color="#00000040" />
              </HapticPressable>
            ) : (
              <PillButton
                title="Paste"
                tone="quiet"
                size="sm"
                className="self-center"
                onPress={() => void handlePaste()}
              />
            )}
          </View>

          {isComplete ? (
            <>
              <DashedRule />
              <Typography weight="500" className="text-[13px] text-black/55">
                Bank
              </Typography>
              {bank ? (
                <HapticPressable
                  accessibilityRole="button"
                  accessibilityLabel={`${bank.name}. Change bank`}
                  onPress={openSearch}
                  className="mt-2 flex-row items-center gap-3"
                >
                  <BankLogo name={bank.name} logoKey={bank.logoKey} />
                  <Typography
                    weight="600"
                    numberOfLines={1}
                    className="flex-1 text-[16px] text-[#0E0F0C]"
                  >
                    {bank.name}
                  </Typography>
                  <Typography weight="600" className="text-[14px] text-info">
                    Change
                  </Typography>
                </HapticPressable>
              ) : candidatesQuery.isLoading ? (
                <View className="mt-3 h-10 flex-row items-center gap-2">
                  <ActivityIndicator size="small" color="#00000059" />
                  <Typography
                    weight="500"
                    className="text-[14px] text-black/55"
                  >
                    Finding the bank…
                  </Typography>
                </View>
              ) : (
                <View className="mt-2 flex-row flex-wrap gap-2">
                  {suggestions.map((suggested) => (
                    <HapticPressable
                      key={suggested.code}
                      accessibilityRole="button"
                      accessibilityLabel={suggested.name}
                      onPress={() => void lookUp(accountNumber, suggested)}
                      className="h-11 flex-row items-center gap-2 rounded-full bg-black/[0.04] pl-1.5 pr-4"
                    >
                      <BankLogo
                        name={suggested.name}
                        logoKey={suggested.logoKey}
                        size="sm"
                      />
                      <Typography
                        weight="600"
                        className="text-[14px] text-[#0E0F0C]"
                      >
                        {shortBankName(suggested.name)}
                      </Typography>
                    </HapticPressable>
                  ))}
                  <HapticPressable
                    accessibilityRole="button"
                    onPress={openSearch}
                    className={cn(
                      "h-11 flex-row items-center gap-2 rounded-full px-4",
                      suggestions.length
                        ? "bg-black/[0.04]"
                        : "flex-1 bg-black/[0.04]"
                    )}
                  >
                    <Ionicons name="search" size={16} color="#0E0F0C" />
                    <Typography
                      weight="600"
                      className="text-[14px] text-[#0E0F0C]"
                    >
                      {suggestions.length ? "Other bank" : "Choose bank"}
                    </Typography>
                  </HapticPressable>
                </View>
              )}
            </>
          ) : null}

          {bank ? (
            <>
              <DashedRule />
              <Typography weight="500" className="text-[13px] text-black/55">
                Account name
              </Typography>
              {check.state === "checking" ? (
                <View className="mt-2 h-7 flex-row items-center gap-2">
                  <ActivityIndicator size="small" color="#00000059" />
                  <Typography
                    weight="500"
                    className="text-[14px] text-black/55"
                  >
                    {`Checking with ${shortBankName(bank.name)}…`}
                  </Typography>
                </View>
              ) : found ? (
                <View className="mt-1 flex-row items-center gap-2">
                  <Typography
                    weight="700"
                    numberOfLines={1}
                    className="shrink text-[18px] leading-[26px] text-[#0E0F0C]"
                  >
                    {found.accountName}
                  </Typography>
                  <Ionicons name="checkmark-circle" size={18} color="#16A34A" />
                </View>
              ) : check.state === "failed" ? (
                <Typography
                  weight="500"
                  className="mt-1 text-[14px] leading-[20px] text-destructive"
                >
                  {check.message}
                </Typography>
              ) : null}
            </>
          ) : null}
        </View>

        {recentAccounts.length > 0 ? (
          <View className="mt-8">
            <Typography
              weight="600"
              className="mb-2 text-[15px] text-[#0E0F0C]"
            >
              Recent accounts
            </Typography>
            {recentAccounts.map((account) => {
              const known = account.bankCode
                ? banksByCode.get(account.bankCode)
                : undefined;
              const grouped = groupAccountNumber(account.accountNumber);
              const sendCount = `${account.sends} send${account.sends === 1 ? "" : "s"}`;
              return (
                <HapticPressable
                  key={`${account.bankCode ?? ""}:${account.accountNumber}`}
                  accessibilityRole="button"
                  onPress={() => openRecent(account)}
                  className="h-[60px] flex-row items-center gap-3"
                >
                  <BankLogo
                    name={known?.name ?? grouped}
                    logoKey={known?.logoKey}
                  />
                  <View className="flex-1">
                    <Typography
                      weight="600"
                      numberOfLines={1}
                      className="text-[15px] text-[#0E0F0C]"
                    >
                      {known?.name ?? grouped}
                    </Typography>
                    <Typography
                      weight="500"
                      className="text-[13px] tabular-nums text-black/55"
                    >
                      {known ? grouped : sendCount}
                    </Typography>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color="#00000066"
                  />
                </HapticPressable>
              );
            })}
          </View>
        ) : null}
      </BottomSheetScrollView>
      <BankSheetFooter>
        <PillButton
          title="Continue"
          disabled={!found}
          onPress={() => found && onNext(found)}
        />
      </BankSheetFooter>

      <BankSearchSheet
        ref={searchRef}
        banks={banksQuery.data ?? []}
        loading={banksQuery.isLoading}
        failed={banksQuery.isError}
        onRetry={() => void banksQuery.refetch()}
        onPick={pickFromSearch}
      />
    </View>
  );
}
