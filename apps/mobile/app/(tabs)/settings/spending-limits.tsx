import React, { useRef, useState } from "react";
import { ActivityIndicator, Image, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { Ionicons } from "@expo/vector-icons";

import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { ThemedButton } from "@/components/ui/molecules";
import { ThemedTextInput } from "@/components/ui/molecules/ThemedTextInput";
import { InfoSheet } from "@/components/ui/organisms/modals/InfoSheet";
import { useAccount } from "@/hooks/useAccount";
import { useInitiatedChanges } from "@/hooks/useInitiatedChange";
import { usePendingAccountChange } from "@/hooks/usePendingAccountChange";
import { useSpendingLimitChange } from "@/hooks/useSpendingLimitChange";
import { apiErrorCode, apiErrorMessage } from "@/utils/apiClient";
import {
  formatUsdcRaw,
  LIMIT_PERIOD_REMAINING,
  LIMIT_PERIOD_WORDS,
  MAX_LIMIT_RAW,
  toUsdcRaw,
} from "@/utils/spendingLimit";
import {
  MISMATCH_MESSAGE,
  TransactionMismatchError,
} from "@/utils/verifyTransaction";

/**
 * The Consumer's Spending Limit, and the two things they can do to it.
 *
 * Neither is instant. Changing the limit is a settings change like moving a
 * key: both signers approve it and it waits a day before it takes effect, and
 * this screen says so rather than showing a saved state that has not happened.
 * A limit a single tap could raise would not be a limit.
 */
export default function SpendingLimitsScreen() {
  const infoSheetRef = useRef<BottomSheetModal>(null);
  const { data: account, isLoading, refetch } = useAccount();
  const { data: pendingChange, isLoading: readingPending } =
    usePendingAccountChange();
  const { startedHere, isPending: readingStarted } = useInitiatedChanges();
  const change = useSpendingLimitChange();

  const [amount, setAmount] = useState("");
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitingUntil, setWaitingUntil] = useState<string | null>(null);
  const [staged, setStaged] = useState<"set" | "removed" | null>(null);

  // Absent is not the same answer as null. Null is an Account with no limit;
  // absent is a backend that did not report one, and showing that as "no
  // limit" would tell a Consumer something about their money that nobody
  // here knows.
  const limit = account?.spendingLimit;
  const typed = toUsdcRaw(amount);
  const issue = amountIssue(amount, limit?.maxPerPeriod ?? null);
  // A limit set from here refills daily, which is what provisioning writes and
  // what an Account without one would get back.
  const period = limit?.period ?? "Daily";

  // A change already waiting on this Account. Which one it is only the device
  // that staged it knows, so this says what is true for any of them rather
  // than claiming it is the limit.
  const waiting = !!pendingChange && !change.isPending;
  const busy =
    change.isPending ||
    waiting ||
    readingPending ||
    readingStarted ||
    isLoading;
  const blocked =
    waiting && !readingStarted
      ? startedHere(pendingChange.transactionIndex)
        ? pendingChange.executableAt
          ? `A change you started lands on ${when(pendingChange.executableAt)}. You can set a new limit after that.`
          : "A change you started is waiting out its one day delay. You can set a new limit once it lands."
        : "Something is changing on your Account. Review that first, then come back."
      : null;

  const canSave =
    !!account && limit !== undefined && !!amount.trim() && !issue && !busy;

  const apply = async (
    request: { maxPerPeriod: string } | { remove: true }
  ) => {
    if (!account) return;
    setError(null);
    try {
      const outcome = await change.mutateAsync({ account, request });
      setWaitingUntil(outcome.waitingUntil);
      setStaged("remove" in request ? "removed" : "set");
    } catch (err) {
      setError(describe(err));
    }
  };

  if (staged) {
    return (
      <Staged
        removed={staged === "removed"}
        waitingUntil={waitingUntil}
        onDone={() => router.navigate("/settings" as never)}
      />
    );
  }

  return (
    <ScreenLayout>
      <View className="flex-1">
        <View className="mt-4 flex-row items-start justify-between">
          <Image
            source={require("@/assets/icons/spending-limt.png")}
            className="size-9"
            resizeMode="contain"
          />
          <HapticPressable
            onPress={() => infoSheetRef.current?.present()}
            className="p-1"
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="About the Spending Limit"
          >
            <Ionicons
              name="information-circle-outline"
              size={22}
              color="#00000066"
            />
          </HapticPressable>
        </View>

        <Typography weight="700" className="mt-4 text-[20px] text-black">
          Spending Limit
        </Typography>
        <Typography
          weight="500"
          className="mt-2 text-[13px] leading-5 text-black/40"
        >
          The most you can Spend on one confirmation.{"\n"}
          Anything above it asks you to confirm twice.
        </Typography>

        <ScrollView
          className="mt-8 flex-1"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {isLoading ? (
            <View className="items-center py-10">
              <ActivityIndicator size="small" color="#00000040" />
            </View>
          ) : !account ? (
            <Card>
              <Typography weight="700" className="text-base text-black">
                Could not load your limit
              </Typography>
              <Typography
                weight="500"
                className="mt-1 text-[13px] leading-5 text-black/40"
              >
                Check your connection and try again.
              </Typography>
              <HapticPressable
                onPress={() => void refetch()}
                className="mt-4 h-11 items-center justify-center self-start rounded-full bg-black px-6"
                accessibilityRole="button"
                accessibilityLabel="Try loading your Spending Limit again"
              >
                <Typography weight="600" className="text-[13px] text-white">
                  Try again
                </Typography>
              </HapticPressable>
            </Card>
          ) : limit === undefined ? (
            <Card>
              <Typography weight="700" className="text-base text-black">
                Your limit is not showing
              </Typography>
              <Typography
                weight="500"
                className="mt-1 text-[13px] leading-5 text-black/40"
              >
                Xend cannot read it right now, so nothing here can be changed.
                Your Account is unaffected. Try again in a moment.
              </Typography>
            </Card>
          ) : limit === null ? (
            <Card>
              <Typography weight="700" className="text-base text-black">
                No Spending Limit
              </Typography>
              <Typography
                weight="500"
                className="mt-1 text-[13px] leading-5 text-black/40"
              >
                Every Spend from this Account needs a second confirmation on
                this phone, however small. Set a limit and Spends under it take
                one confirmation instead of two.
              </Typography>
            </Card>
          ) : (
            <Card>
              <Typography weight="500" className="text-[13px] text-black/40">
                Your limit now
              </Typography>
              <Typography
                weight="700"
                className="mt-1 text-[32px] tabular-nums leading-[38px] text-black"
              >
                {formatUsdcRaw(limit.maxPerPeriod)}{" "}
                {LIMIT_PERIOD_WORDS[limit.period]}
              </Typography>
              <Typography
                weight="500"
                className="mt-2 text-[15px] tabular-nums text-black/40"
              >
                {formatUsdcRaw(limit.remainingInPeriod)}{" "}
                {LIMIT_PERIOD_REMAINING[limit.period]}
              </Typography>
            </Card>
          )}

          {limit !== undefined && (
            <>
              <Typography weight="600" className="mt-8 text-[15px] text-black">
                {limit ? "Set a new limit" : "Set a limit"}
              </Typography>
              <View className="mt-3">
                <ThemedTextInput
                  value={amount}
                  onChangeText={(next) => {
                    setAmount(next);
                    setError(null);
                  }}
                  placeholder={`Amount ${LIMIT_PERIOD_WORDS[period]}`}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  editable={!busy && !removing}
                  error={!!issue}
                  accessibilityLabel={`Spending Limit, ${LIMIT_PERIOD_WORDS[period]}`}
                />
              </View>
              {issue ? (
                <Typography
                  weight="500"
                  className="mt-2 text-[13px] leading-5 text-destructive"
                >
                  {issue}
                </Typography>
              ) : null}
              <Typography
                weight="400"
                className="mt-3 text-[12px] leading-[18px] text-black/40"
              >
                {limit
                  ? "Both keys on this phone approve the new limit, and it takes effect one day later. Until then the limit you have now still applies."
                  : "Both keys on this phone approve the limit, and it takes effect one day later. Until then every Spend still needs two confirmations."}
              </Typography>

              {limit && (
                <View className="mt-8 rounded-3xl border border-black/[0.07] p-5">
                  <Typography weight="600" className="text-[15px] text-black">
                    {removing ? "Remove the limit?" : "Remove the limit"}
                  </Typography>
                  <Typography
                    weight="500"
                    className="mt-1 text-[13px] leading-5 text-black/40"
                  >
                    {removing
                      ? "Every Spend, however small, will then need a second confirmation on this phone. Both keys approve this too, and it takes effect one day later."
                      : "Your Account keeps working and gets stricter, not looser: every Spend, however small, then needs a second confirmation on this phone."}
                  </Typography>
                </View>
              )}
            </>
          )}

          {blocked && (
            <Typography
              weight="500"
              className="mt-6 text-[13px] leading-5 text-black/40"
            >
              {blocked}
            </Typography>
          )}

          {error && (
            <Typography weight="500" className="mt-6 text-sm text-destructive">
              {error}
            </Typography>
          )}

          {change.isPending && (
            <View className="mt-8 items-center">
              <ActivityIndicator color="#000" />
              <Typography weight="500" className="mt-3 text-sm text-black/40">
                Approving on this phone
              </Typography>
            </View>
          )}
        </ScrollView>

        {limit === null && (
          <View className="mt-4">
            <ThemedButton
              title="Set limit"
              variant="secondary"
              disabled={!canSave}
              onPress={() => {
                if (typed !== null)
                  void apply({ maxPerPeriod: typed.toString() });
              }}
            />
          </View>
        )}

        {limit && (
          <View className="mt-4 flex-row justify-between gap-3">
            <View className="flex-1">
              <ThemedButton
                title={removing ? "Remove it" : "Remove limit"}
                variant="quiet"
                disabled={busy}
                onPress={() =>
                  removing ? void apply({ remove: true }) : setRemoving(true)
                }
              />
            </View>
            <View className="flex-1">
              <ThemedButton
                title={removing ? "Keep it" : "Save"}
                variant="secondary"
                disabled={removing ? change.isPending : !canSave}
                onPress={() => {
                  if (removing) {
                    setRemoving(false);
                    return;
                  }
                  if (typed !== null) {
                    void apply({ maxPerPeriod: typed.toString() });
                  }
                }}
              />
            </View>
          </View>
        )}

        <HapticPressable
          // To Settings, not back. This screen is reachable from the home
          // banner, and `back` from there returns to the home tab and strands
          // the settings stack on a sub-screen.
          onPress={() => router.navigate("/settings" as never)}
          className="mt-2 size-12 items-center justify-center"
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back to settings"
        >
          <Ionicons name="chevron-back" size={24} color="#000000" />
        </HapticPressable>
      </View>

      <InfoSheet
        ref={infoSheetRef}
        iconName="time-outline"
        iconBackground="#000000"
        title="Spending Limit"
        description={
          <>
            <Typography
              weight="400"
              className="text-center text-base leading-6 text-black/50"
            >
              Your Account is held by two keys. Up to the limit, this phone can
              Spend on one of them, so an everyday payment is one tap.
            </Typography>
            <Typography
              weight="400"
              className="text-center text-base leading-6 text-black/50"
            >
              Above it, both keys are asked. Raising, lowering or removing the
              limit is a change to your Account, so it waits one day and can be
              rejected from your phone until then.
            </Typography>
          </>
        }
        actionLabel="Got it"
      />
    </ScreenLayout>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View className="rounded-3xl border border-black/[0.07] bg-black/[0.02] p-5">
      {children}
    </View>
  );
}

function Staged({
  removed,
  waitingUntil,
  onDone,
}: {
  removed: boolean;
  waitingUntil: string | null;
  onDone: () => void;
}) {
  const lands = waitingUntil ? `on ${when(waitingUntil)}` : "in one day";
  return (
    <ScreenLayout>
      <View className="flex-1 items-center justify-center px-3">
        <View className="size-16 items-center justify-center rounded-3xl bg-black">
          <Ionicons name="time-outline" size={30} color="#FFFFFF" />
        </View>
        <Typography weight="700" className="mt-6 text-3xl text-black">
          Change on its way
        </Typography>
        <Typography
          weight="500"
          className="mt-3 text-center text-base leading-6 text-black/40"
        >
          {removed
            ? `Your Spending Limit comes off ${lands}. After that every Spend needs a second confirmation on this phone.`
            : `Your Spending Limit takes effect ${lands}.`}
        </Typography>
        <Typography
          weight="400"
          className="mt-6 text-center text-sm leading-5 text-black/40"
        >
          Until then nothing changes, and this phone can cancel the change if it
          was not you.
        </Typography>
        <HapticPressable
          onPress={onDone}
          className="mt-10 h-14 w-full items-center justify-center rounded-full bg-black"
          accessibilityRole="button"
          accessibilityLabel="Done"
        >
          <Typography weight="700" className="text-[15px] text-white">
            Done
          </Typography>
        </HapticPressable>
      </View>
    </ScreenLayout>
  );
}

/**
 * What is wrong with what the Consumer typed, or null while there is nothing
 * to say.
 *
 * Every one of these is a refusal the backend would give back a step later,
 * after two biometric prompts, so they are answered here instead.
 */
function amountIssue(amount: string, current: string | null): string | null {
  if (amount.trim() === "") return null;
  const raw = toUsdcRaw(amount);
  if (raw === null) return "Enter an amount, like 50 or 12.50.";
  if (raw === 0n) return "Enter an amount above zero.";
  if (raw > MAX_LIMIT_RAW) return "That is larger than a limit can be.";
  if (current !== null && raw.toString() === current) {
    return "That is the limit you have now.";
  }
  return null;
}

/**
 * The refusals the Consumer can act on say what they are; everything else is
 * one sentence. A limit the Account already carries and a change already in
 * flight are both things they can fix, and flattening them would leave the
 * screen with nothing to say.
 */
function describe(err: unknown): string {
  if (err instanceof TransactionMismatchError) return MISMATCH_MESSAGE;
  if (apiErrorCode(err) === "SPENDING_LIMIT_CHANGE_REFUSED") {
    return apiErrorMessage(err) ?? "That change was not accepted.";
  }
  return "Could not start that change. Check your connection and try again.";
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}
