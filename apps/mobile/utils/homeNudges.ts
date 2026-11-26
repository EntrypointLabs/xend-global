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
 * What the slot under the balance offers once the balance has something in
 * it. Things the Consumer has not tried yet come first; Earn is always there
 * behind them, so the slot is never empty, the way Fuse keeps its own.
 */
export function homeNudges(input: NudgeInputs): Nudge[] {
  const { cashUsd } = input;
  if (cashUsd === null || cashUsd <= 0) return [];
  const nudges: Nudge[] = [];

  const earn: Nudge | null = input.earnDepositsEnabled
    ? {
        key: "earn",
        title:
          input.earnApy > 0
            ? `Earn up to ${input.earnApy}% per year`
            : "Earn on your dollars",
        subtitle: "Put your dollars into Earn",
      }
    : null;
  const triedEarn = input.earnUsd !== null && input.earnUsd > 0;
  if (earn && !triedEarn) nudges.push(earn);

  // Bank payouts go to Nigerian accounts only.
  if (input.currency === "NGN" && input.symbol && input.perUsd) {
    nudges.push({
      key: "bank-payout",
      title: "Send to any bank",
      subtitle: `${formatRateLabel(input.symbol, input.perUsd, input.currency)} today`,
    });
  }

  if (earn && triedEarn) nudges.push(earn);
  return nudges;
}
