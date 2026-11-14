import { useQuery } from "@tanstack/react-query";

export interface WatchedToken {
  mint: string;
  name: string;
  symbol: string;
  iconUrl?: string;
  usdPrice: number | null;
  change24h: number | null;
}

const TOKENS = [
  {
    mint: "So11111111111111111111111111111111111111112",
    name: "Solana",
    symbol: "SOL",
  },
  {
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    name: "Jupiter",
    symbol: "JUP",
    iconUrl: "https://static.jup.ag/jup/icon.png",
  },
  {
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    name: "Bonk",
    symbol: "BONK",
  },
  {
    mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
    name: "Jito",
    symbol: "JTO",
  },
];

const PRICE_URL = "https://lite-api.jup.ag/price/v3";
const TOKEN_URL = "https://lite-api.jup.ag/tokens/v2/search";

interface PriceEntry {
  usdPrice?: number;
  priceChange24h?: number;
}

/**
 * Prices for a fixed set of well-known tokens, from Jupiter's public endpoint.
 * The list is the same for everyone and the rows render without a price while
 * it loads or if the request fails, so the section never blocks Home.
 */
export function useWatchlist(enabled: boolean) {
  const query = useQuery({
    queryKey: ["watchlist-prices"],
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const ids = TOKENS.map((token) => token.mint).join(",");
      const response = await fetch(`${PRICE_URL}?ids=${ids}`);
      if (!response.ok)
        throw new Error(`Price request failed: ${response.status}`);
      return (await response.json()) as Record<string, PriceEntry | undefined>;
    },
  });

  // Logos come from the token index, since none of these but SOL ship with the
  // app. A day's cache is plenty; a logo does not change.
  const icons = useQuery({
    queryKey: ["watchlist-icons"],
    enabled,
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: async () => {
      const ids = TOKENS.map((token) => token.mint).join(",");
      const response = await fetch(`${TOKEN_URL}?query=${ids}`);
      if (!response.ok)
        throw new Error(`Token request failed: ${response.status}`);
      const rows = (await response.json()) as { id: string; icon?: string }[];
      return Object.fromEntries(rows.map((row) => [row.id, row.icon]));
    },
  });

  const tokens: WatchedToken[] = TOKENS.map((token) => {
    const price = query.data?.[token.mint];
    return {
      ...token,
      iconUrl: icons.data?.[token.mint] ?? token.iconUrl,
      usdPrice: price?.usdPrice ?? null,
      change24h: price?.priceChange24h ?? null,
    };
  });

  return { tokens, isError: query.isError };
}
