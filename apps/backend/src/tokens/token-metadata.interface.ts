/** DI token for the active token metadata provider. */
export const TOKEN_METADATA_PROVIDER = Symbol('TokenMetadataProvider');

export interface TokenMetadata {
  /** What a Consumer calls it: "Solana", not "SOL". */
  name: string;
  symbol: string;
  /**
   * Absolute URL of the token's logo, or null when the source has none.
   * Null rather than a placeholder URL so the client picks its own fallback
   * instead of rendering a broken image.
   */
  iconUrl: string | null;
}

export interface TokenMetadataProvider {
  /** Metadata keyed by mint. Mints the source does not know are absent. */
  getMetadata(mints: string[]): Promise<Map<string, TokenMetadata>>;
}
