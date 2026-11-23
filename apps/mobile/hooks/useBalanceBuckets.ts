import { useRouter } from "expo-router";

import type { BalanceBucket } from "@/components/ui/organisms/home/BalanceBuckets";
import { useBalances } from "@/hooks/useBalances";
import { useEarnPosition } from "@/hooks/useEarn";
import { useFeature } from "@/hooks/useFeature";
import { formatMoney } from "@/utils/balances";

/**
 * The parts the total balance is made of, each leading to its own page.
 * Investments is listed only where swapping is on, and Earn only once it holds
 * money, so every part shown is one the Consumer can act on.
 */
export function useBalanceBuckets(): BalanceBucket[] {
  const router = useRouter();
  const swapEnabled = useFeature("swap");
  const { portfolio, isError } = useBalances();
  const { balance: earnBalance } = useEarnPosition();
  // A failed read leaves the portfolio at zero, which must not be shown as an
  // empty account.
  const fromWallet = (usd: number) => (isError ? "—" : `$${formatMoney(usd)}`);

  const buckets: BalanceBucket[] = [
    {
      key: "cash",
      label: "Cash",
      amount: fromWallet(portfolio.cashUsd),
      icon: "cash-outline",
      onPress: () => router.push("/cash"),
    },
  ];
  if (swapEnabled) {
    buckets.push({
      key: "investments",
      label: "Investments",
      amount: fromWallet(portfolio.investmentsUsd),
      icon: "trending-up-outline",
      onPress: () => router.push("/investments"),
    });
  }
  if (earnBalance > 0) {
    buckets.push({
      key: "earn",
      label: "Earn",
      amount: `$${formatMoney(earnBalance)}`,
      icon: "leaf-outline",
      onPress: () => router.push("/earn"),
    });
  }
  return buckets;
}
