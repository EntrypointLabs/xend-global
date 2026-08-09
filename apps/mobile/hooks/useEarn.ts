export interface EarnProduct {
  id: string;
  provider: string;
  name: string;
  description: string;
  apyDisplay: string;
}

/**
 * Yield products on offer.
 *
 * Static for now because there is exactly one and its rate is quoted rather
 * than live. When rates come from the provider this becomes a query and the
 * screen does not change.
 */
export const EARN_PRODUCTS: EarnProduct[] = [
  {
    id: "kamino-lending",
    provider: "Kamino",
    name: "Lending Yield",
    description:
      "Deposit your stablecoins with Kamino to earn yield from optimized lending vaults.",
    apyDisplay: "4.37%",
  },
];

export interface EarnPosition {
  /** Display units. Drives whether the Consumer has a position at all. */
  balance: number;
  balanceDisplay: string;
  apyDisplay: string;
  lifetimeEarned: string;
  lastSevenDays: string;
}

/**
 * The Consumer's Earn position.
 *
 * Deposits are not wired yet, so this is a genuine zero rather than a
 * placeholder: nobody has a position, and the screen says so accurately. When
 * deposits land this reads them and the screen is already correct.
 */
export function useEarnPosition(): EarnPosition {
  return {
    balance: 0,
    balanceDisplay: "0.00",
    // Zero while the Consumer has nothing deposited. The product's own rate is
    // on its card, which is what they are choosing between.
    apyDisplay: "0.00%",
    lifetimeEarned: "0.00",
    lastSevenDays: "0.00",
  };
}
