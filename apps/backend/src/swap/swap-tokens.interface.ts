export const SWAP_TOKEN_DIRECTORY = Symbol('SWAP_TOKEN_DIRECTORY');

/** The shelves Swap sorts its assets onto. */
export const SWAP_TOKEN_CATEGORIES = [
  'crypto',
  'stable',
  'stocks',
  'meme',
] as const;
export type SwapTokenCategory = (typeof SWAP_TOKEN_CATEGORIES)[number];

/** An asset a Consumer can choose to swap into. */
export interface SwapToken {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  iconUrl: string | null;
  category: SwapTokenCategory;
  /** USD per whole token, or null when nothing prices it. */
  usdPrice: number | null;
}

/**
 * The assets offered in Swap. Only ones the source has verified: a ticker is
 * not an identity, and anyone can mint a second "USDC".
 */
export interface SwapTokenDirectory {
  /**
   * What is shown before the Consumer has typed anything. Without a category
   * it is the everyday list, which leaves tokenized stocks and meme tokens to
   * their own shelves.
   */
  popular(category?: SwapTokenCategory): Promise<SwapToken[]>;
  /** Every category at once: someone typing a name knows what they want. */
  search(query: string): Promise<SwapToken[]>;
}
