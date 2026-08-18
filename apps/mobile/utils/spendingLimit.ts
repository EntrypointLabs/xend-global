import type { AccountResponse } from "@/utils/apiClient";
import { getUsdcMint } from "@/utils/cluster";

const USDC_DECIMALS = 6;

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
