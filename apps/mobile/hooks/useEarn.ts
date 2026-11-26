import type { ImageSourcePropType } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useUserId } from "@/hooks/useUserId";
import { apiClient } from "@/utils/apiClient";
import { SEED_DEMO } from "@/utils/devSeed";
import {
  formatEarnedMinor,
  productEarnings,
  selectEarnBalance,
  productCanWithdraw,
  productHasExternalReceipts,
  productValueUsd,
  productEarningsUsd,
  catalogEarnings,
  type EarnProvider,
  type EarnRange,
  type TokenRange,
  type EarnAssetSchema,
} from "@/utils/earn";
import { useWalletAddress } from "@/hooks/useWalletAddress";
import { fetchEarnFromChain } from "@/utils/earnChain";
import { getUsdcMint } from "@/utils/cluster";
import { WRAPPED_SOL_MINT } from "@/utils/tokens";
import type { z } from "zod";

export interface EarnAsset {
  mint: string;
  symbol: string;
  name: string;
  iconUrl: string | null;
  decimals: number;
  apy: number | null;
  apyDisplay: string;
  /** Units of this token in the product. Null until read. */
  position: number | null;
  /** What the position is worth, or null when nothing could price it. */
  positionUsd: number | null;
  withdrawable: number;
  /** Units of this token earned so far, when known. */
  lifetimeEarned: number | null;
  lastSevenDaysEarned: number | null;
  /**
   * Units the vault holds and could deposit, as the server counts them. Null
   * when it does not say, and the app's own balances stand in.
   */
  depositable: number | null;
  available: boolean;
  withdrawAvailable: boolean;
}

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
  /** Every token the product lends, USDC first. */
  assets: EarnAsset[];
}
export const EARN_PRODUCTS: EarnProduct[] = [
  {
    id: "kamino",
    provider: "Kamino",
    name: "Flexible interest",
    description: "Put your dollars to work and earn interest with Kamino.",
    apyDisplay: "—",
    apy: null,
    learnMoreUrl: "https://kamino.com",
    about:
      "Kamino is a lending market on Solana. Your dollars are lent to borrowers through Kamino, and you earn the interest they pay. The rate moves with how much is supplied and how much is borrowed.",
    network: "Solana",
    icon: require("@/assets/icons/kamino.png"),
    assets: [],
  },
  {
    id: "jupiter",
    provider: "Jupiter Lend",
    name: "Flexible interest",
    description: "Put your assets to work and earn interest with Jupiter Lend.",
    apyDisplay: "—",
    apy: null,
    learnMoreUrl: "https://jup.ag/lend",
    about:
      "Jupiter Lend is the lending market from Jupiter on Solana. Your assets are lent to borrowers through Jupiter Lend, and you earn the interest they pay. The rate moves with how much is supplied and how much is borrowed.",
    network: "Solana",
    icon: require("@/assets/icons/jupiter.png"),
    assets: [],
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
      // The product-level earnings are USDC only; token rows cover the rest.
      const earned =
        (live && productEarningsUsd(live)) ?? productEarnings(query.data, p.id);
      const apy = SEED_DEMO ? 0.0359 : (live?.apy ?? null);
      const position = SEED_DEMO
        ? 0
        : live && !query.isError
          ? productValueUsd(live)
          : null;
      const available =
        !SEED_DEMO && sessionTier === "full" && !!live?.available;
      const withdrawAvailable =
        !SEED_DEMO && sessionTier === "full" && !!live?.withdrawAvailable;
      return {
        ...p,
        assets: SEED_DEMO
          ? (DEMO_ASSETS[p.id] ?? [])
          : live?.assets?.length
            ? live.assets
                .map((asset) => toAsset(asset, sessionTier))
                .sort(byListingOrder)
            : [
                {
                  ...USDC_ASSET,
                  apy,
                  apyDisplay: apy === null ? "—" : `${(apy * 100).toFixed(2)}%`,
                  position:
                    live && !query.isError
                      ? Number(live.positionMinor) / 1e6
                      : null,
                  positionUsd:
                    live && !query.isError
                      ? Number(live.positionMinor) / 1e6
                      : null,
                  withdrawable: live ? Number(live.withdrawableMinor) / 1e6 : 0,
                  lifetimeEarned:
                    earned.lifetimeMinor === null
                      ? null
                      : Math.max(0, Number(earned.lifetimeMinor) / 1e6),
                  lastSevenDaysEarned:
                    earned.lastSevenDaysMinor === null
                      ? null
                      : Math.max(0, Number(earned.lastSevenDaysMinor) / 1e6),
                  depositable: null,
                  available,
                  withdrawAvailable,
                },
              ],
        apy,
        apyDisplay: apy === null ? "—" : `${(apy * 100).toFixed(2)}%`,
        simulated: SEED_DEMO,
        position,
        lifetimeEarned: SEED_DEMO
          ? "0.00"
          : formatEarnedMinor(earned.lifetimeMinor),
        lastSevenDays: SEED_DEMO
          ? "0.00"
          : formatEarnedMinor(earned.lastSevenDaysMinor),
        available,
        withdrawAvailable,
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
  /** USDC each product's canonical receipt accounts can withdraw, in dollars. */
  withdrawableBalances: Record<string, number>;
  /** Whether each product has any token, USDC or not, that can be withdrawn. */
  canWithdraw: Record<string, boolean>;
  /**
   * The positions were read, so withdrawals can be offered from each token's
   * own amount even when the dollar total is unknown.
   */
  positionsRead: boolean;
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
  // Each held token at its own rate, weighted by what it is worth.
  const held = (products ?? []).flatMap((p) =>
    p.assets?.length
      ? p.assets
          .filter((a) => BigInt(a.positionRaw) > 0n)
          .map((a) => ({
            apy: a.apy,
            usd: a.positionUsd === null ? null : Number(a.positionUsd),
          }))
      : BigInt(p.positionMinor) > 0n
        ? [{ apy: p.apy, usd: Number(p.positionMinor) / 1e6 }]
        : []
  );
  const unknownHeldRate = held.some((h) => h.apy === null || h.usd === null);
  const earned = catalogEarnings(query.data);
  const weighted = held.reduce(
    (sum, h) => sum + (h.apy ?? 0) * (h.usd ?? 0),
    0
  );
  return {
    withdrawableBalances: balances,
    positionsRead: SEED_DEMO || (!!products && !query.isError),
    canWithdraw: Object.fromEntries(
      products?.map((p) => [p.id, productCanWithdraw(p)]) ?? []
    ),
    hasExternalReceipts: !!products?.some(productHasExternalReceipts),
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
      : formatEarnedMinor(earned.lifetimeMinor),
    lastSevenDays: SEED_DEMO
      ? "0.00"
      : formatEarnedMinor(earned.lastSevenDaysMinor),
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

const USDC_ASSET = {
  mint: getUsdcMint(),
  symbol: "USDC",
  name: "USD Coin",
  iconUrl: null,
  decimals: 6,
};

const percent = (apy: number | null) =>
  apy === null ? "—" : `${(apy * 100).toFixed(2)}%`;

function toAsset(
  asset: z.infer<typeof EarnAssetSchema>,
  sessionTier: string | null | undefined
): EarnAsset {
  const scale = 10 ** asset.decimals;
  return {
    mint: asset.mint,
    symbol: asset.symbol,
    name: asset.name,
    iconUrl: asset.iconUrl,
    decimals: asset.decimals,
    apy: asset.apy,
    apyDisplay: percent(asset.apy),
    position: Number(asset.positionRaw) / scale,
    positionUsd: asset.positionUsd === null ? null : Number(asset.positionUsd),
    withdrawable: Number(asset.withdrawableRaw) / scale,
    lifetimeEarned:
      asset.lifetimeEarnedRaw === null
        ? null
        : Number(asset.lifetimeEarnedRaw) / scale,
    lastSevenDaysEarned:
      asset.lastSevenDaysEarnedRaw === null
        ? null
        : Number(asset.lastSevenDaysEarnedRaw) / scale,
    depositable: Number(asset.depositableRaw) / scale,
    available: sessionTier === "full" && asset.available,
    withdrawAvailable: sessionTier === "full" && asset.withdrawAvailable,
  };
}

const demoAsset = (
  mint: string,
  symbol: string,
  name: string,
  decimals: number,
  apy: number,
  iconUrl: string | null = null
): EarnAsset => ({
  mint,
  symbol,
  name,
  iconUrl,
  decimals,
  apy,
  apyDisplay: percent(apy),
  position: 0,
  positionUsd: 0,
  withdrawable: 0,
  lifetimeEarned: 0,
  lastSevenDaysEarned: 0,
  depositable: null,
  available: false,
  withdrawAvailable: false,
});

/** What the demo build lends, so the multi-token layout can be reviewed. */
const DEMO_ASSETS: Partial<Record<EarnProvider, EarnAsset[]>> = {
  kamino: [demoAsset(USDC_ASSET.mint, "USDC", "USD Coin", 6, 0.0359)],
  jupiter: [
    demoAsset(USDC_ASSET.mint, "USDC", "USD Coin", 6, 0.0359),
    demoAsset(
      "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      "USDT",
      "Tether USD",
      6,
      0.0418,
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg"
    ),
    demoAsset(WRAPPED_SOL_MINT, "SOL", "Solana", 9, 0.0612),
    demoAsset(
      "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
      "USDG",
      "Global Dollar",
      6,
      0.0455
    ),
  ],
};

export function useTokenOverview(mint: string, range: TokenRange) {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: ["token-overview", mint, range],
    queryFn: () => apiClient.getTokenOverview(mint, range),
    enabled: !!isAuthenticated && !!mint,
    staleTime: 60000,
    retry: 1,
  });
}

/** Dollars first (USDC, then USDT), then SOL, then everything else. */
const LISTING_ORDER = ["USDC", "USDT", "SOL"];
function byListingOrder(a: EarnAsset, b: EarnAsset) {
  const rank = (asset: EarnAsset) => {
    const i = LISTING_ORDER.indexOf(asset.symbol);
    return i === -1 ? LISTING_ORDER.length : i;
  };
  return rank(a) - rank(b);
}
