import type { ImageSourcePropType } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useUserId } from "@/hooks/useUserId";
import { apiClient } from "@/utils/apiClient";
import { SEED_DEMO } from "@/utils/devSeed";
import type { EarnProvider } from "@/utils/earn";

export interface EarnProduct {
  id: EarnProvider;
  provider: string;
  name: string;
  description: string;
  apyDisplay: string;
  apy: number | null;
  learnMoreUrl: string;
  network: string;
  simulated?: boolean;
  available?: boolean;
  withdrawAvailable?: boolean;
  icon?: ImageSourcePropType;
}
export const EARN_PRODUCTS: EarnProduct[] = [
  {
    id: "kamino",
    provider: "Kamino",
    name: "Lending Yield",
    description: "Put your dollars to work and earn interest with Kamino.",
    apyDisplay: "—",
    apy: null,
    learnMoreUrl: "https://kamino.com",
    network: "Solana",
    icon: require("@/assets/icons/kamino.png"),
  },
  {
    id: "jupiter",
    provider: "Jupiter Lend",
    name: "Lending Yield",
    description:
      "Put your dollars to work and earn interest with Jupiter Lend.",
    apyDisplay: "—",
    apy: null,
    learnMoreUrl: "https://jup.ag/lend",
    network: "Solana",
  },
];
function useEarnData() {
  const { isAuthenticated } = useAuth();
  const userId = useUserId();
  return useQuery({
    queryKey: ["earn", userId],
    queryFn: () => apiClient.getEarn(),
    enabled: !!isAuthenticated && !SEED_DEMO,
    staleTime: 15000,
    refetchInterval: 30000,
    retry: 1,
  });
}
export function useEarnProducts() {
  const query = useEarnData();
  return {
    ...query,
    products: EARN_PRODUCTS.map((p) => {
      const live = query.data?.products.find((row) => row.id === p.id);
      const apy = SEED_DEMO ? 0.0359 : (live?.apy ?? null);
      return {
        ...p,
        apy,
        apyDisplay: apy === null ? "—" : `${(apy * 100).toFixed(2)}%`,
        simulated: SEED_DEMO,
        available: !SEED_DEMO && !!live?.available,
        withdrawAvailable: !SEED_DEMO && !!live?.withdrawAvailable,
      };
    }),
  };
}
export function earnHeadlineApy(): string {
  return "—";
}
export interface EarnPosition {
  productBalances: Record<string, number>;
  balance: number;
  balanceDisplay: string;
  apyDisplay: string;
  lifetimeEarned: string;
  lastSevenDays: string;
}
export function useEarnPosition(): EarnPosition {
  const query = useEarnData();
  const products = query.data?.products;
  const balances = Object.fromEntries(
    products?.map((p) => [p.id, Number(p.positionMinor) / 1e6]) ?? []
  );
  const balance = Object.values(balances).reduce((sum, n) => sum + n, 0);
  const unknownHeldRate = products?.some(
    (p) => BigInt(p.positionMinor) > 0n && p.apy === null
  );
  const weighted =
    products?.reduce(
      (sum, p) => sum + (p.apy ?? 0) * (Number(p.positionMinor) / 1e6),
      0
    ) ?? 0;
  return {
    productBalances: balances,
    balance,
    balanceDisplay: SEED_DEMO ? "0.00" : products ? balance.toFixed(2) : "—",
    apyDisplay:
      balance > 0 && !unknownHeldRate
        ? `${((weighted / balance) * 100).toFixed(2)}%`
        : unknownHeldRate || (!SEED_DEMO && !products)
          ? "—"
          : "0.00%",
    lifetimeEarned: SEED_DEMO
      ? "0.00"
      : query.data?.lifetimeMinor != null
        ? (Number(query.data.lifetimeMinor) / 1e6).toFixed(2)
        : "—",
    lastSevenDays: SEED_DEMO
      ? "0.00"
      : query.data?.lastSevenDaysMinor != null
        ? (Number(query.data.lastSevenDaysMinor) / 1e6).toFixed(2)
        : "—",
  };
}
