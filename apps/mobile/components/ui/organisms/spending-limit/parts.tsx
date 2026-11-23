import React from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";

import { Typography } from "@/components/ui/atoms/Typography";
import { PillButton } from "@/components/ui/kit";
import { Illustration } from "@/components/ui/feature/Illustration";
import { Pop, Rise } from "@/components/ui/motion";
import { usePalette } from "@/hooks/usePalette";
import { useInitiatedChanges } from "@/hooks/useInitiatedChange";
import { usePendingAccountChange } from "@/hooks/usePendingAccountChange";
import { apiErrorCode, apiErrorMessage } from "@/utils/apiClient";
import {
  MISMATCH_MESSAGE,
  TransactionMismatchError,
} from "@/utils/verifyTransaction";

const DISPLAY = { fontFamily: "Montserrat_900Black" } as const;

export function LimitHero() {
  return (
    <View className="overflow-hidden rounded-[28px] bg-muted px-6 pb-5 pt-7">
      <Typography
        accessibilityRole="header"
        className="text-[34px] uppercase leading-[34px] tracking-[-1px] text-ink"
        style={DISPLAY}
      >
        Quick pay
      </Typography>
      <Typography
        weight="500"
        className="mt-2 max-w-[200px] text-[14px] leading-[20px] text-foreground/55"
      >
        Pay up to this amount with one check. Bigger payments ask again.
      </Typography>
      <View className="absolute -bottom-3 -right-3">
        <Illustration name="limit" size={140} />
      </View>
      <View className="h-14" />
    </View>
  );
}

/**
 * Shown the moment a change is staged. Nothing has changed yet, so it says
 * when it will and that this phone can still stop it.
 */
export function OnItsWay({
  amount,
  removed,
  waitingUntil,
  onDone,
}: {
  /** The new amount as the Consumer reads it, such as "$2,500 a day". */
  amount: string | null;
  removed: boolean;
  waitingUntil: string | null;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const lands = waitingUntil ? `on ${when(waitingUntil)}` : "in 24 hours";
  const headline = removed
    ? `Quick pay switches off ${lands}.`
    : amount
      ? `Quick pay changes to ${amount} ${lands}.`
      : `Your new Quick pay amount starts ${lands}.`;
  return (
    <View
      className="flex-1 bg-background px-5"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom + 12 }}
    >
      <StatusBar style="auto" />
      <View className="flex-1 items-center justify-center">
        <Pop haptic="success">
          <Illustration name="calendar" size={150} />
        </Pop>
        <Rise index={2}>
          <Typography
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
            className="mt-8 text-center text-[34px] uppercase leading-[34px] tracking-[-1px] text-ink"
            style={DISPLAY}
          >
            On its way
          </Typography>
        </Rise>
        <Rise index={3}>
          <Typography
            weight="500"
            className="mt-3 max-w-[300px] text-center text-[15px] leading-[21px] text-foreground/60"
          >
            {headline} Nothing changes until then, and if it was not you, you
            can stop it from this phone.
          </Typography>
        </Rise>
      </View>
      <PillButton title="Done" tone="quiet" onPress={onDone} />
    </View>
  );
}

/** A change already waiting on the Account, said in a line under the limit. */
export function PendingNote({ title, body }: { title: string; body: string }) {
  const palette = usePalette();
  return (
    <View className="mt-6 flex-row gap-3 rounded-[24px] border border-foreground/[0.06] p-5">
      <Ionicons name="time-outline" size={20} color={palette.ink} />
      <View className="flex-1">
        <Typography
          weight="600"
          className="text-[15px] leading-[20px] text-ink"
        >
          {title}
        </Typography>
        <Typography
          weight="500"
          className="mt-1 text-[13px] leading-[19px] text-foreground/50"
        >
          {body}
        </Typography>
      </View>
    </View>
  );
}

export interface WaitingChange {
  title: string;
  body: string;
  /** Said in the footer in place of an action. */
  footer: string;
}

/**
 * A change already waiting on this Account, or null when there is none.
 *
 * Which change it is only the device that staged it knows, so this says what
 * is true for any of them rather than claiming it is the limit.
 */
export function useWaitingChange(): {
  waiting: WaitingChange | null;
  reading: boolean;
} {
  const { data: pending, isLoading } = usePendingAccountChange();
  const { startedHere, isPending: readingStarted } = useInitiatedChanges();
  const reading = isLoading || readingStarted;
  if (!pending) return { waiting: null, reading };
  if (readingStarted) {
    return {
      reading,
      waiting: {
        title: "A change is on its way",
        body: "You can change your amount again once it starts.",
        footer: "Waiting on a change",
      },
    };
  }
  if (!startedHere(pending.transactionIndex)) {
    return {
      reading,
      waiting: {
        title: "Something on your Account is changing",
        body: "Check that first, then come back.",
        footer: "Waiting on another change",
      },
    };
  }
  return {
    reading,
    waiting: pending.executableAt
      ? {
          title: "A change is on its way",
          body: "You made it on this phone. You can change your amount again once it starts.",
          footer: `Starts ${when(pending.executableAt)}`,
        }
      : {
          title: "A change is on its way",
          body: "You made it on this phone. It starts within 24 hours.",
          footer: "Starts within 24 hours",
        },
  };
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The refusals the Consumer can act on say what they are; everything else is
 * one sentence. A limit the Account already carries and a change already in
 * flight are both things they can fix, and flattening them would leave the
 * screen with nothing to say.
 */
export function describeChangeError(err: unknown): string {
  if (err instanceof TransactionMismatchError) return MISMATCH_MESSAGE;
  if (apiErrorCode(err) === "SPENDING_LIMIT_CHANGE_REFUSED") {
    return apiErrorMessage(err) ?? "That change was not accepted.";
  }
  return "Could not start that change. Check your connection and try again.";
}
