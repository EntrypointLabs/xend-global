import type { AccountResponse, SpendingLimit } from "@/utils/apiClient";
import { getUsdcMint } from "@/utils/cluster";

const USDC_DECIMALS = 6;

type SpendingLimitPeriod = SpendingLimit["period"];

/**
 * A typed amount as an integer at USDC's decimals, or null when it is not a
 * number the Consumer could have meant.
 *
 * Parsed off the string rather than through Number, which loses cents on
 * amounts a Consumer can plausibly hold and would compare the wrong figure
 * against the limit.
 */
export function toUsdcRaw(amount: string): bigint | null {
  const trimmed = amount.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") {
    return null;
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const cents = (fraction + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  return BigInt(whole || "0") * 10n ** BigInt(USDC_DECIMALS) + BigInt(cents);
}

/**
 * What the Consumer is told, per reason.
 *
 * Lives beside the rule rather than in a screen because both amount entries
 * show it: the standalone send screen and the one inside the send sheet.
 *
 * "May" rather than "will" on `above-remaining`, because that reason rests on a
 * counter that can be out of date. Promising two checks and asking once reads
 * as a bug; warning of a possibility that does not arrive does not.
 */
export const SECOND_CHECK_NOTE: Record<SecondCheckReason, string> = {
  "above-daily-limit": "Above your daily limit. You will confirm this twice.",
  "above-remaining": "Close to your daily limit. You may confirm this twice.",
  "no-limit": "You will confirm this twice.",
};

/** Why this send will be confirmed twice instead of once. */
export type SecondCheckReason =
  | "above-daily-limit"
  | "above-remaining"
  | "no-limit";

export interface SecondCheck {
  reason: SecondCheckReason;
  /**
   * False for `above-remaining` only. What is left in the period is a stored
   * counter that the program refills as a send goes through under the limit,
   * so a Consumer whose day has already rolled over reads low until their next
   * one lands. Everything else here is settled by figures that do not move.
   */
  certain: boolean;
}

/**
 * Whether a send of this amount will ask the Consumer twice.
 *
 * Null means unknown, and unknown is deliberately silent: before the Account
 * exists there is no limit to be over, and a limit denominated in some other
 * mint says nothing about this amount. The authoritative answer comes back
 * from `POST /transfers/prepare`; this exists only so the Consumer can be told
 * before they get there.
 */
export function describeSecondCheck(
  account: AccountResponse | null | undefined,
  amount: string
): SecondCheck | null {
  if (!account || account.spendingLimit === undefined) return null;

  const raw = toUsdcRaw(amount);
  if (raw === null || raw === 0n) return null;

  const limit = account.spendingLimit;
  // No limit is not "no ceiling". With nothing admitting a send on one
  // confirmation, every send takes two.
  if (limit === null) return { reason: "no-limit", certain: true };
  if (limit.mint !== getUsdcMint()) return null;

  if (raw > BigInt(limit.maxPerUse)) {
    return { reason: "above-daily-limit", certain: true };
  }
  if (raw > BigInt(limit.remainingInPeriod)) {
    return { reason: "above-remaining", certain: false };
  }
  return null;
}

/** How often the limit refills, in the words the Consumer reads. */
export const LIMIT_PERIOD_WORDS: Record<SpendingLimitPeriod, string> = {
  OneTime: "in total",
  Daily: "a day",
  Weekly: "a week",
  Monthly: "a month",
};

/**
 * What is left of the limit, in the words the Consumer reads.
 *
 * A second phrasing rather than a reuse of {@link LIMIT_PERIOD_WORDS}, because
 * "$40 a day left" says something the counter does not: the figure is what
 * remains of this one period, not a rate.
 */
export const LIMIT_PERIOD_REMAINING: Record<SpendingLimitPeriod, string> = {
  OneTime: "left",
  Daily: "left today",
  Weekly: "left this week",
  Monthly: "left this month",
};

/**
 * The largest limit an Account can carry.
 *
 * The policy stores the cap as a u64, so anything past this is refused several
 * steps into the change rather than at the keyboard. Nothing a Consumer means
 * to type comes near it; a stray paste does.
 */
export const MAX_LIMIT_RAW = 2n ** 64n - 1n;

/**
 * An integer at USDC's decimals as money: "100000000" reads "$100".
 *
 * Cents only when there are any. The limits a Consumer sets are round numbers,
 * and "$100.00 a day" reads like a figure somebody calculated for them.
 */
export function formatUsdcRaw(raw: string): string {
  const unit = 10n ** BigInt(USDC_DECIMALS);
  const value = BigInt(raw);
  const whole = (value / unit).toLocaleString("en-US");
  const fraction = (value % unit)
    .toString()
    .padStart(USDC_DECIMALS, "0")
    .replace(/0+$/, "");
  return fraction ? `$${whole}.${fraction}` : `$${whole}`;
}
