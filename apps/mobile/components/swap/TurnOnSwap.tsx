import React from "react";
import * as Sentry from "@sentry/react-native";

import {
  FeatureIntro,
  type FeatureBenefit,
} from "@/components/ui/feature/FeatureIntro";
import { useToast } from "@/contexts/ToastContext";
import { useTurnOnSwap } from "@/hooks/useSwapAccess";
import { isUserCanceledSign } from "@/utils/signing";
import type { SwapAccessStatus } from "@/utils/apiClient";
import {
  MISMATCH_MESSAGE,
  TransactionMismatchError,
} from "@/utils/verifyTransaction";

const BEFORE: FeatureBenefit[] = [
  {
    icon: "finger-print-outline",
    title: "Confirm once",
    body: "One check that it is you, and you are done.",
  },
  {
    icon: "time-outline",
    title: "Ready in 24 hours",
    body: "New permissions on your account wait a day, so you can stop one you did not ask for.",
  },
  {
    icon: "lock-closed-outline",
    title: "Nothing moves",
    body: "Your money stays where it is until you make a swap.",
  },
];

const WAITING: FeatureBenefit[] = [
  {
    icon: "checkmark-circle-outline",
    title: "You have confirmed",
    body: "Nothing more to do. Swap turns on by itself.",
  },
  {
    icon: "time-outline",
    title: "A day to be sure",
    body: "New permissions on your account wait a day, so you can stop one you did not ask for.",
  },
  {
    icon: "close-circle-outline",
    title: "Changed your mind?",
    body: "Cancel it from Keys & Recovery in Settings.",
  },
];

/**
 * Swap, for an Account set up before Swap existed.
 *
 * Shown in place of the swap screen until the Account can swap: first as the
 * offer to turn it on, then as the wait while the security delay runs.
 */
export function TurnOnSwap({ access }: { access: SwapAccessStatus }) {
  const { showToast } = useToast();
  const turnOn = useTurnOnSwap();

  const start = () =>
    turnOn.mutate(undefined, {
      onError: (error) => {
        // A dismissed prompt is a decision, not a fault.
        if (isUserCanceledSign(error)) return;
        Sentry.captureException(error, { tags: { surface: "swap.access" } });
        showToast(describe(error));
      },
    });

  if (access.state === "pending") {
    return (
      <FeatureIntro
        illustration="convert"
        headline="Swap is on its way"
        benefits={WAITING}
        waiting={
          access.executableAt
            ? `Ready ${when(access.executableAt)}`
            : "Ready in 24 hours"
        }
      />
    );
  }

  return (
    <FeatureIntro
      illustration="convert"
      headline="Swap what you hold"
      benefits={BEFORE}
      cta={{
        title: "Turn on Swap",
        onPress: start,
        loading: turnOn.isPending,
      }}
    />
  );
}

function describe(error: unknown): string {
  if (error instanceof TransactionMismatchError) return MISMATCH_MESSAGE;
  const data = (error as { data?: { code?: string; message?: string } })?.data;
  if (data?.code === "SWAP_ACCESS_REFUSED" && data.message) {
    return sentence(data.message);
  }
  return "Swap could not be turned on. Nothing has changed.";
}

function sentence(message: string): string {
  const text = message.charAt(0).toUpperCase() + message.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}
