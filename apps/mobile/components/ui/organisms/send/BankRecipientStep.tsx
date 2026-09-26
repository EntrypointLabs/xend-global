import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  BottomSheetFlatList,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { TextInput } from "react-native-gesture-handler";
import { useQuery } from "@tanstack/react-query";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";
import { PillButton } from "@/components/ui/kit";
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
import { RecipientEmptyState, RecipientRow } from "./RecipientParts";

interface BankRecipientStepProps {
  onNext: (recipient: BankRecipient) => void;
  recipient?: string;
  setRecipient?: (recipient: string) => void;
}

type Stage =
  | { name: "number" }
  | { name: "bank"; showAll: boolean; error: string | null }
  | { name: "checking"; bank: Bank }
  | { name: "confirmed"; recipient: BankRecipient };

type RecentAccount = {
  accountNumber: string;
  bankCode: string | null;
  sends: number;
};

const BANK_ROW_HEIGHT = 56;
const BANK_LIST_STALE_MS = 6 * 60 * 60 * 1000;

function BankIcon({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <View
      className={cn(
        "items-center justify-center rounded-2xl bg-black/5",
        size === "md" ? "size-10" : "size-12"
      )}
    >
      <MaterialCommunityIcons
        name="bank-outline"
        size={size === "md" ? 20 : 24}
        color="black"
      />
    </View>
  );
}

function BankRow({ bank, onPress }: { bank: Bank; onPress: () => void }) {
  return (
    <HapticPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={bank.name}
      className="mx-5 h-[56px] flex-row items-center gap-3"
    >
      <BankIcon />
      <Typography
        weight="500"
        numberOfLines={1}
        className="flex-1 text-[15px] text-black"
      >
        {bank.name}
      </Typography>
      <Ionicons name="chevron-forward" size={16} color="#00000066" />
    </HapticPressable>
  );
}

function SheetHeader({
  title,
  onBack,
}: {
  title: string;
  onBack?: () => void;
}) {
  return (
    <View className="mb-8 flex-row items-center justify-between px-4">
      {onBack ? (
        <HapticPressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="size-10 items-center justify-center rounded-full bg-black/5"
        >
          <Ionicons name="chevron-back" size={20} color="black" />
        </HapticPressable>
      ) : (
        <View className="size-10" />
      )}
      <TabHeaderText className="pb-0 text-center font-semibold">
        {title}
      </TabHeaderText>
      <View className="size-10" />
    </View>
  );
}

function matchesSearch(name: string, query: string): boolean {
  const haystack = name.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function resolveFailure(error: unknown, bankName: string): string {
  if (error instanceof BankAccountNotFoundError)
    return `We couldn't find this account at ${bankName}. Check the number or pick another bank.`;
  if (apiErrorStatus(error) === 429)
    return (
      apiErrorMessage(error) ??
      "Too many account checks. Try again in a few minutes."
    );
  return `We couldn't reach ${bankName} right now. Try again or pick another bank.`;
}

export default function BankRecipientStep({
  onNext,
  recipient,
  setRecipient,
}: BankRecipientStepProps) {
  const inputRef = useRef<TextInput | null>(null);
  const [localNumber, setLocalNumber] = useState(recipient ?? "");
  const accountNumber = recipient ?? localNumber;
  const setAccountNumber = setRecipient ?? setLocalNumber;
  const [stage, setStage] = useState<Stage>({ name: "number" });
  const [search, setSearch] = useState("");
  const checkId = useRef(0);

  const { data, isLoading } = useUnifiedFiat("NGN");
  const banksQuery = useQuery({
    queryKey: ["fiat", "banks"],
    queryFn: () => apiClient.banks(),
    staleTime: BANK_LIST_STALE_MS,
    gcTime: BANK_LIST_STALE_MS,
  });
  const isComplete = isAccountNumber(accountNumber);
  const candidatesQuery = useQuery({
    queryKey: ["fiat", "bank-candidates", accountNumber],
    queryFn: () => apiClient.bankCandidates(accountNumber),
    enabled: isComplete && stage.name !== "number",
    staleTime: Infinity,
  });

  const banksByCode = useMemo(
    () => new Map((banksQuery.data ?? []).map((bank) => [bank.code, bank])),
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
    if (stage.name !== "number") return;
    const timer = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, [stage.name]);

  const chooseBank = () => {
    Keyboard.dismiss();
    setSearch("");
    setStage({ name: "bank", showAll: false, error: null });
  };

  const check = async (number: string, bank: Bank) => {
    Keyboard.dismiss();
    const id = ++checkId.current;
    setStage({ name: "checking", bank });
    try {
      const confirmed = await apiClient.resolveBankRecipient(number, bank.code);
      if (id !== checkId.current) return;
      setStage({ name: "confirmed", recipient: confirmed });
    } catch (error) {
      if (id !== checkId.current) return;
      setStage({
        name: "bank",
        showAll: false,
        error: resolveFailure(error, bank.name),
      });
    }
  };

  const backToNumber = () => {
    checkId.current += 1;
    setStage({ name: "number" });
  };

  const backToBanks = () => {
    checkId.current += 1;
    setSearch("");
    setStage({ name: "bank", showAll: false, error: null });
  };

  const handleChange = (text: string) => {
    const next = text.replace(/\D/g, "").slice(0, ACCOUNT_NUMBER_LENGTH);
    setAccountNumber(next);
    if (next.length === ACCOUNT_NUMBER_LENGTH && accountNumber !== next)
      chooseBank();
  };

  const handlePaste = async () => {
    const text = await Clipboard.getStringAsync();
    const pasted = text ? extractAccountNumber(text) : null;
    if (!pasted) return;
    setAccountNumber(pasted);
    chooseBank();
  };

  const handleContinue = () => {
    if (isComplete) chooseBank();
  };

  const openRecent = (account: RecentAccount) => {
    setAccountNumber(account.accountNumber);
    const bank = account.bankCode ? banksByCode.get(account.bankCode) : null;
    if (bank) void check(account.accountNumber, bank);
    else chooseBank();
  };

  if (stage.name === "checking" || stage.name === "confirmed") {
    const confirmed = stage.name === "confirmed" ? stage.recipient : null;
    const bankName =
      stage.name === "confirmed" ? stage.recipient.bankName : stage.bank.name;
    return (
      <View className="flex-1 bg-[#F0F0F0]">
        <SheetHeader title="Confirm recipient" onBack={backToBanks} />
        <View className="mx-4 rounded-[24px] border border-white bg-[#F9F9F9] p-5">
          <BankIcon size="lg" />
          {confirmed ? (
            <>
              <Typography
                weight="700"
                className="mt-4 text-[22px] leading-[28px] text-black"
              >
                {confirmed.accountName}
              </Typography>
              <Typography
                weight="500"
                className="mt-1 text-[13px] tabular-nums text-black/40"
              >
                {`${bankName} · ${groupAccountNumber(confirmed.accountNumber)}`}
              </Typography>
            </>
          ) : (
            <>
              <View className="mt-4 flex-row items-center gap-2">
                <ActivityIndicator size="small" color="#00000040" />
                <Typography weight="500" className="text-[15px] text-black/40">
                  Checking account…
                </Typography>
              </View>
              <Typography
                weight="500"
                className="mt-1 text-[13px] tabular-nums text-black/30"
              >
                {`${bankName} · ${groupAccountNumber(accountNumber)}`}
              </Typography>
            </>
          )}
        </View>
        {confirmed ? (
          <Typography
            weight="400"
            className="mx-5 mt-3 text-[12px] leading-[18px] text-black/40"
          >
            This is the name the bank has on the account. Make sure it is who
            you want to pay.
          </Typography>
        ) : null}
        <View className="mx-4 mt-6 flex-row gap-3">
          <PillButton
            title="Change bank"
            tone="quiet"
            onPress={backToBanks}
            className="flex-1"
          />
          <PillButton
            title="Continue"
            onPress={() => confirmed && onNext(confirmed)}
            disabled={!confirmed}
            className="flex-1"
          />
        </View>
      </View>
    );
  }

  if (stage.name === "bank") {
    const candidates = candidatesQuery.data ?? [];
    const noSuggestions = !candidatesQuery.isLoading && candidates.length === 0;
    const showAll = stage.showAll || noSuggestions || search.length > 0;
    const allBanks = banksQuery.data ?? [];
    const filtered = search
      ? allBanks.filter((bank) => matchesSearch(bank.name, search))
      : allBanks;
    const pick = (bank: Bank) => void check(accountNumber, bank);

    const intro = (
      <View className="mx-5 mb-4">
        <Typography weight="500" className="text-[13px] text-black/40">
          {`Account ${groupAccountNumber(accountNumber)}`}
        </Typography>
        {stage.error ? (
          <Typography
            weight="500"
            className="mt-2 text-[13px] leading-5 text-destructive"
          >
            {stage.error}
          </Typography>
        ) : null}
      </View>
    );

    return (
      <View className="flex-1 bg-[#F0F0F0]">
        <SheetHeader title="Which bank?" onBack={backToNumber} />
        {intro}
        {showAll ? (
          <>
            <View className="mx-4 mb-3 h-12 flex-row items-center gap-2 rounded-full bg-black/5 px-4">
              <Ionicons name="search" size={16} color="#00000066" />
              <BottomSheetTextInput
                className="flex-1 py-0 font-inter-medium text-[15px] text-black"
                placeholder="Search banks"
                placeholderTextColor="#0000004D"
                value={search}
                onChangeText={setSearch}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
              />
              {search ? (
                <HapticPressable
                  onPress={() => setSearch("")}
                  accessibilityLabel="Clear search"
                >
                  <Ionicons name="close-circle" size={18} color="lightgrey" />
                </HapticPressable>
              ) : null}
            </View>
            {banksQuery.isLoading ? (
              <View className="items-center py-10">
                <ActivityIndicator size="small" color="#00000040" />
              </View>
            ) : banksQuery.isError ? (
              <View className="mx-4 rounded-3xl border border-black/[0.07] bg-black/[0.02] p-5">
                <Typography weight="600" className="text-[15px] text-black">
                  Could not load banks
                </Typography>
                <Typography
                  weight="500"
                  className="mt-1 text-[13px] text-black/40"
                >
                  Check your connection and try again.
                </Typography>
                <PillButton
                  title="Try again"
                  tone="quiet"
                  size="sm"
                  className="mt-3"
                  onPress={() => void banksQuery.refetch()}
                />
              </View>
            ) : (
              <BottomSheetFlatList
                data={filtered}
                keyExtractor={(bank: Bank) => bank.code}
                renderItem={({ item }: { item: Bank }) => (
                  <BankRow bank={item} onPress={() => pick(item)} />
                )}
                getItemLayout={(_: unknown, index: number) => ({
                  length: BANK_ROW_HEIGHT,
                  offset: BANK_ROW_HEIGHT * index,
                  index,
                })}
                initialNumToRender={16}
                maxToRenderPerBatch={24}
                windowSize={7}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <Typography
                    weight="500"
                    className="mx-5 py-10 text-center text-[15px] text-black/30"
                  >
                    {`No banks match "${search}"`}
                  </Typography>
                }
              />
            )}
          </>
        ) : (
          <BottomSheetScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Typography weight="600" className="mx-5 mb-1 text-[15px]">
              Likely banks
            </Typography>
            {candidatesQuery.isLoading ? (
              <View className="items-center py-10">
                <ActivityIndicator size="small" color="#00000040" />
              </View>
            ) : (
              candidates.map((bank) => (
                <BankRow
                  key={bank.code}
                  bank={bank}
                  onPress={() => pick(bank)}
                />
              ))
            )}
            <View className="mx-5 my-2 h-px bg-black/10" />
            <HapticPressable
              onPress={() => setStage({ ...stage, showAll: true })}
              accessibilityRole="button"
              className="mx-5 h-[56px] flex-row items-center gap-3"
            >
              <View className="size-10 items-center justify-center rounded-2xl bg-black/5">
                <Ionicons name="list" size={20} color="black" />
              </View>
              <Typography
                weight="600"
                className="flex-1 text-[15px] text-black"
              >
                Show all banks
              </Typography>
              <Ionicons name="chevron-forward" size={16} color="#00000066" />
            </HapticPressable>
          </BottomSheetScrollView>
        )}
      </View>
    );
  }

  const sends = isComplete
    ? recentAccounts
        .filter((a) => a.accountNumber === accountNumber)
        .reduce((total, a) => total + a.sends, 0)
    : 0;
  const helper = !isComplete
    ? "Enter a 10-digit account number"
    : sends === 0
      ? "New account"
      : `${sends} send${sends === 1 ? "" : "s"}`;

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View className="flex-1 bg-[#F0F0F0]">
        <SheetHeader title="Choose recipient" />

        <View className="mx-4 mb-8 rounded-[24px] border border-white bg-[#F9F9F9] p-4">
          <TouchableOpacity
            className="relative bg-transparent"
            onPress={() => inputRef.current?.focus()}
          >
            <BottomSheetTextInput
              className="-ml-1 mb-1.5 w-[235px] py-0 font-inter-medium text-base text-black/90"
              placeholder="Account number"
              placeholderTextColor="#0000004D"
              value={accountNumber}
              onChangeText={handleChange}
              keyboardType="number-pad"
              maxLength={ACCOUNT_NUMBER_LENGTH}
              autoCorrect={false}
              ref={inputRef}
              returnKeyType="go"
              onSubmitEditing={handleContinue}
              submitBehavior="blurAndSubmit"
            />
            <TouchableOpacity
              onPress={() => inputRef.current?.focus()}
              className="mb-2.5 flex-row items-center justify-start gap-1"
            >
              {isComplete && (
                <MaterialCommunityIcons
                  name="clock-time-nine"
                  size={14}
                  color="lightgrey"
                />
              )}
              <Typography weight="600" className="text-xs text-black/30">
                {helper}
              </Typography>
            </TouchableOpacity>

            {accountNumber.length > 0 && (
              <HapticPressable
                className="absolute -right-5 -top-5 z-10 p-5"
                onPress={() => setAccountNumber("")}
              >
                <Ionicons name="close-circle" size={20} color="lightgrey" />
              </HapticPressable>
            )}
          </TouchableOpacity>

          <View className="flex-row gap-2.5">
            <HapticPressable
              className={cn(
                "rounded-full px-6 py-[8px]",
                isComplete ? "bg-black" : "bg-black/30"
              )}
              onPress={handleContinue}
              disabled={!isComplete}
            >
              <Typography weight="600" className="text-white">
                Continue
              </Typography>
            </HapticPressable>

            <HapticPressable
              className="flex-row items-center gap-1 rounded-full bg-black/10 px-6 py-[8px]"
              onPress={handlePaste}
            >
              <Ionicons name="document" size={16} color="black" />
              <Typography weight="600" className="text-black">
                Paste
              </Typography>
            </HapticPressable>
          </View>
        </View>

        {recentAccounts.length > 0 ? (
          <BottomSheetScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Typography weight="600" className="mb-4 ml-5 text-lg">
              Recent accounts
            </Typography>
            {recentAccounts.map((account) => {
              const bank = account.bankCode
                ? banksByCode.get(account.bankCode)
                : undefined;
              const grouped = groupAccountNumber(account.accountNumber);
              const sendCount = `${account.sends} send${account.sends === 1 ? "" : "s"}`;
              return (
                <RecipientRow
                  key={`${account.bankCode ?? ""}:${account.accountNumber}`}
                  title={bank?.name ?? grouped}
                  subtitle={bank ? grouped : sendCount}
                  icon={
                    <MaterialCommunityIcons
                      name="bank-outline"
                      size={22}
                      color="black"
                    />
                  }
                  onPress={() => openRecent(account)}
                />
              );
            })}
          </BottomSheetScrollView>
        ) : (
          !isLoading && (
            <RecipientEmptyState
              title="You have no accounts yet"
              subtitle="Enter an account number to continue"
            />
          )
        )}
      </View>
    </TouchableWithoutFeedback>
  );
}
