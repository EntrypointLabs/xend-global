import { PublicKey } from '@solana/web3.js';
import type { SpendingLimitTerms } from '@xend/smart-account';

/**
 * The band a Spend may cross on one signature, from O3.
 *
 * O3 resolves two figures: US $100 per transaction with $300 cumulative, and
 * Nigeria NGN 200,000 per rolling 24 hours under CBN's OTP-grade tier. Nothing
 * on an Account records which one a Consumer falls under, so this applies the
 * lower of the two to everyone. Erring the other way would put a Nigerian
 * Consumer over a regulatory ceiling on a single signature, which is the one
 * failure here that is not merely inconvenient.
 *
 * ## The conversion, and why it is fixed
 *
 * The policy lives on chain denominated in USDC, so the naira ceiling has to be
 * carried across at some rate, and an on-chain constant cannot track a floating
 * one. $100 is chosen to stay under NGN 200,000 across the plausible band: it
 * holds down to NGN 2,000 per dollar, well past the current rate. If the naira
 * moves past that, this number is wrong in the unsafe direction and has to come
 * down.
 *
 * ## Per-use equals per-period
 *
 * CBN's ladder caps the day, not the transaction, so a Consumer may spend the
 * whole allowance at once. Setting `maxPerUse` lower would add a second, finer
 * limit that no regulation asks for.
 *
 * Changing these terms on an existing Account is a settings change, not a
 * config edit: it needs two signatures and waits out the time lock.
 */
const USDC_DECIMALS = 6;
const DAILY_CEILING_USD = 100n;

export function buildDefaultSpendingLimit(mint: PublicKey): SpendingLimitTerms {
  const ceiling = DAILY_CEILING_USD * 10n ** BigInt(USDC_DECIMALS);
  return {
    mint,
    maxPerUse: ceiling,
    maxPerPeriod: ceiling,
    period: 'Daily',
    // Any destination. The limit is about value per day, not about who is paid,
    // and an allowlist here would break ordinary sends to new recipients.
    destinations: [],
  };
}
