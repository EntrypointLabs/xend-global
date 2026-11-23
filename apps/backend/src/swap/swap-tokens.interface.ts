export const SWAP_TOKEN_DIRECTORY = Symbol('SWAP_TOKEN_DIRECTORY');

/** An asset a Consumer can choose to swap into. */
export interface SwapToken {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  iconUrl: string | null;
}

/**
 * The assets offered in Swap. Only ones the source has verified: a ticker is
 * not an identity, and anyone can mint a second "USDC".
 */
export interface SwapTokenDirectory {
  /** What is shown before the Consumer has typed anything. */
  popular(): Promise<SwapToken[]>;
  search(query: string): Promise<SwapToken[]>;
}
