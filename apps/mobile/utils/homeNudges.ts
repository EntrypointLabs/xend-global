import { formatRateLabel } from "@/utils/displayRates";

export type NudgeKey = "earn" | "bank-payout";

export interface Nudge {
  key: NudgeKey;
  title: string;
  subtitle: string;
}

export interface NudgeInputs {
  /** Spendable dollars. Null until the balance has loaded. */
  cashUsd: number | null;
  earnUsd: number | null;
  earnDepositsEnabled: boolean;
  /** The best Earn rate on offer, as a percentage such as 4.37. */
  earnApy: number;
  /** The country card's currency and symbol, and its dollar rate if known. */
  currency: string | null;
  symbol: string | null;
  perUsd: number | undefined;
}

/**
 * Things the Consumer has not tried yet, offered once nothing needs them. Each
 * one stops on its own once it no longer applies: Earn once money is in it,
 * and both when there is nothing to put to work.
 */
export function homeNudges(input: NudgeInputs): Nudge[] {
  const { cashUsd } = input;
  if (cashUsd === null || cashUsd <= 0) return [];
  const nudges: Nudge[] = [];

  if (input.earnDepositsEnabled && input.earnUsd === 0 && input.earnApy > 0) {
    nudges.push({
      key: "earn",
      title: `Earn up to ${input.earnApy}% per year`,
      subtitle: "Put your dollars into Earn",
    });
  }

  // Bank payouts go to Nigerian accounts only.
  if (input.currency === "NGN" && input.symbol && input.perUsd) {
    nudges.push({
      key: "bank-payout",
      title: "Send to any bank",
      subtitle: `${formatRateLabel(input.symbol, input.perUsd, input.currency)} today`,
    });
  }

  return nudges;
}
