export const SWAP_TOKEN_DIRECTORY = Symbol('SWAP_TOKEN_DIRECTORY');

/** The shelves Swap sorts its assets onto. */
export const SWAP_TOKEN_CATEGORIES = ['crypto', 'stocks', 'meme'] as const;
export type SwapTokenCategory = (typeof SWAP_TOKEN_CATEGORIES)[number];

/**
 * How far a token's identity can be relied on. `caution` is an unverified
 * token wearing a verified one's ticker: the one a Consumer is most likely to
 * buy by mistake.
 */
export type SwapTokenTrust = 'verified' | 'unverified' | 'caution';

/** An asset a Consumer can choose to swap into. */
export interface SwapToken {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  iconUrl: string | null;
  category: SwapTokenCategory;
  trust: SwapTokenTrust;
  /** USD per whole token, or null when nothing prices it. */
  usdPrice: number | null;
}

/**
 * The assets offered in Swap. A ticker is not an identity, and anyone can
 * mint a second "USDC", so the lists a Consumer browses hold verified tokens
 * only. A search can reach the rest, each marked for what it is.
 */
export interface SwapTokenDirectory {
  /**
   * What is shown before the Consumer has typed anything. Without a category
   * it is the everyday list, which leaves tokenized stocks and meme tokens to
   * their own shelves.
   */
  popular(category?: SwapTokenCategory): Promise<SwapToken[]>;
  /**
   * Every category at once, verified or not: someone typing a name knows
   * what they want, and has to be able to tell it from its copies.
   */
  search(query: string): Promise<SwapToken[]>;
}
