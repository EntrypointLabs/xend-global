import type { ImageSourcePropType } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useUserId } from "@/hooks/useUserId";
import { apiClient } from "@/utils/apiClient";
import { SEED_DEMO } from "@/utils/devSeed";
import {
  formatEarnedMinor,
  selectEarnBalance,
  type EarnProvider,
  type EarnRange,
} from "@/utils/earn";
import { useWalletAddress } from "@/hooks/useWalletAddress";
import { fetchEarnFromChain } from "@/utils/earnChain";

export interface EarnProduct {
  id: EarnProvider;
  provider: string;
  name: string;
  description: string;
  apyDisplay: string;
  apy: number | null;
  learnMoreUrl: string;
  /** What the protocol is and how it pays, for the position page. */
  about: string;
  network: string;
  /** Dollars currently in this product. Null until read. */
  position?: number | null;
  lifetimeEarned?: string;
  lastSevenDays?: string;
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
    about:
      "Kamino is a lending market on Solana. Your dollars are lent to borrowers through Kamino, and you earn the interest they pay. The rate moves with how much is supplied and how much is borrowed.",
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
    about:
      "Jupiter Lend is the lending market from Jupiter on Solana. Your dollars are lent to borrowers through Jupiter Lend, and you earn the interest they pay. The rate moves with how much is supplied and how much is borrowed.",
    network: "Solana",
    icon: require("@/assets/icons/jupiter.png"),
  },
];
function useEarnData() {
  const { isAuthenticated } = useAuth();
  const userId = useUserId();
  const address = useWalletAddress();
  return useQuery({
    queryKey: ["earn", userId],
    queryFn: async () => {
      try {
        return await apiClient.getEarn();
      } catch (error) {
        if (!address) throw error;
        return fetchEarnFromChain(address);
      }
    },
    enabled: !!isAuthenticated && !SEED_DEMO,
    staleTime: 15000,
    refetchInterval: 30000,
    retry: 1,
  });
}
export function useEarnProducts() {
  const { sessionTier } = useAuth();
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
        position: SEED_DEMO
          ? 0
          : live && !query.isError
            ? Number(live.positionMinor) / 1e6
            : null,
        lifetimeEarned: SEED_DEMO
          ? "0.00"
          : formatEarnedMinor(live?.lifetimeMinor),
        lastSevenDays: SEED_DEMO
          ? "0.00"
          : formatEarnedMinor(live?.lastSevenDaysMinor),
        available: !SEED_DEMO && sessionTier === "full" && !!live?.available,
        withdrawAvailable:
          !SEED_DEMO && sessionTier === "full" && !!live?.withdrawAvailable,
      };
    }),
  };
}
export function useEarnHeadlineApy(): number {
  const { products } = useEarnProducts();
  return products.reduce(
    (best, p) =>
      (p.available || p.simulated) && p.apy !== null && p.apy * 100 > best
        ? p.apy * 100
        : best,
    0
  );
}
export interface EarnPosition {
  /** Canonical receipt accounts the current withdrawal route can spend. */
  withdrawableBalances: Record<string, number>;
  balance: number | null;
  depositableMinor: string | null;
  hasExternalReceipts: boolean;
  isLoading: boolean;
  isError: boolean;
  refetch: ReturnType<typeof useEarnData>["refetch"];
  balanceDisplay: string;
  apyDisplay: string;
  lifetimeEarned: string;
  lastSevenDays: string;
}
export function useEarnPosition(): EarnPosition {
  const query = useEarnData();
  const products = query.data?.products;
  const balances = Object.fromEntries(
    products?.map((p) => [p.id, Number(p.withdrawableMinor) / 1e6]) ?? []
  );
  const balance = SEED_DEMO ? 0 : selectEarnBalance(products, query.isError);
  const unknownHeldRate = products?.some(
    (p) => BigInt(p.positionMinor) > 0n && p.apy === null
  );
  const weighted =
    products?.reduce(
      (sum, p) => sum + (p.apy ?? 0) * (Number(p.positionMinor) / 1e6),
      0
    ) ?? 0;
  return {
    withdrawableBalances: balances,
    hasExternalReceipts: !!products?.some(
      (p) => BigInt(p.positionMinor) > BigInt(p.withdrawableMinor)
    ),
    balance,
    depositableMinor: query.isError
      ? null
      : (query.data?.depositableMinor ?? null),
    isLoading: !SEED_DEMO && query.isPending,
    isError: !SEED_DEMO && query.isError,
    refetch: query.refetch,
    balanceDisplay: balance === null ? "—" : balance.toFixed(2),
    apyDisplay:
      balance !== null && balance > 0 && !unknownHeldRate
        ? `${((weighted / balance) * 100).toFixed(2)}%`
        : unknownHeldRate || balance === null
          ? "—"
          : "0.00%",
    lifetimeEarned: SEED_DEMO
      ? "0.00"
      : formatEarnedMinor(query.data?.lifetimeMinor),
    lastSevenDays: SEED_DEMO
      ? "0.00"
      : formatEarnedMinor(query.data?.lastSevenDaysMinor),
  };
}

export function useEarnHistory(provider: EarnProvider, range: EarnRange) {
  const { isAuthenticated } = useAuth();
  const userId = useUserId();
  return useQuery({
    queryKey: ["earn", userId, "history", provider, range],
    queryFn: () => apiClient.getEarnHistory(provider, range),
    enabled: !!isAuthenticated && !SEED_DEMO,
    staleTime: 60000,
    retry: 1,
  });
}
