import { formatMoney } from "@/utils/balances";
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
  earnUsd: number;
  earnDepositsEnabled: boolean;
  /** The best Earn rate on offer, as a percentage such as 4.37. */
  earnApy: number;
  /** The country card's currency and symbol, and its dollar rate if known. */
  currency: string | null;
  symbol: string | null;
  perUsd: number | undefined;
}

/**
 * Below this the yearly figure rounds to nothing, so the nudge quotes the rate
 * instead of promising "about $0".
 */
const MIN_YEARLY_TO_QUOTE = 1;

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
    const yearly = (cashUsd * input.earnApy) / 100;
    nudges.push({
      key: "earn",
      title: `Earn ${input.earnApy}% a year`,
      subtitle:
        yearly >= MIN_YEARLY_TO_QUOTE
          ? `Your $${formatMoney(cashUsd)} could make about $${Math.round(yearly)} a year`
          : "On dollars you are not spending yet",
    });
  }

  // Bank payouts go to Nigerian accounts only.
  if (input.currency === "NGN" && input.symbol && input.perUsd) {
    nudges.push({
      key: "bank-payout",
      title: "Send to any Nigerian bank",
      subtitle: `${formatRateLabel(input.symbol, input.perUsd, input.currency)} today`,
    });
  }

  return nudges;
}
