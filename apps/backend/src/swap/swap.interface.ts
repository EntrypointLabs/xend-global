import type {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';

export const SWAP_PROVIDER = Symbol('SWAP_PROVIDER');
export const SWAP_CHAIN = Symbol('SWAP_CHAIN');
export const SWAP_RECORDS = Symbol('SWAP_RECORDS');

/** What a broadcast swap exchanged, kept so Activity can call it a swap. */
export interface SwapRecord {
  userId: string;
  signature: string;
  inputMint: string;
  outputMint: string;
  amountInRaw: string;
  amountOutRaw: string;
  /** The venues the route ran through, in order. */
  venues: string[];
}

export interface SwapRecords {
  record(swap: SwapRecord): Promise<void>;
}

/** A price a venue offered, and whatever it needs back to build the route. */
export interface SwapPrice {
  inputMint: string;
  outputMint: string;
  /** Integer strings at each mint's own decimals. */
  amountInRaw: string;
  amountOutRaw: string;
  slippageBps: number;
  /** Where the trade is routed, for display. */
  venue: string | null;
  /** Every venue the route passes through, as the provider names them. */
  venues: string[];
  /** The provider's own quote, passed back to it untouched. */
  providerQuote: unknown;
}

export interface SwapRoute {
  /** One instruction the vault can authorise, built for that vault. */
  instruction: TransactionInstruction;
  lookupTables: string[];
}

/**
 * Where swaps are priced and routed.
 *
 * A seam rather than a direct call so a second venue can sit beside the first.
 * Whatever implements it has to hand back a route the Account's own signers
 * can execute from the vault: a transaction the provider has already signed,
 * or one that expects an ordinary wallet as the owner, cannot be wrapped in a
 * Spend at all.
 */
export interface SwapProvider {
  readonly name: string;
  quote(params: {
    inputMint: string;
    outputMint: string;
    amountInRaw: string;
    slippageBps: number;
    /** One venue, no intermediate hops: a smaller route at a worse price. */
    directOnly?: boolean;
    /** Venues to route around, as `SwapPrice.venues` names them. */
    excludeVenues?: string[];
  }): Promise<SwapPrice>;
  route(price: SwapPrice, vault: PublicKey): Promise<SwapRoute>;
}

export interface CompiledSwap {
  unsignedTxBase64: string;
  messageBase64: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface SwapChain {
  readonly feePayer: string;
  tokenProgramFor(mint: PublicKey): Promise<PublicKey>;
  /** Whether each address holds an account, in the order asked. */
  exists(addresses: PublicKey[]): Promise<boolean[]>;
  /** The programs the Account's above-limit policy admits. */
  allowedPrograms(policy: PublicKey): Promise<PublicKey[]>;
  lookupTables(addresses: string[]): Promise<AddressLookupTableAccount[]>;
  /**
   * The transaction as it would be sent, without asking the chain anything:
   * what a route has to fit inside, and what the signing device will read.
   */
  draft(params: {
    instructions: TransactionInstruction[];
    lookupTables: AddressLookupTableAccount[];
  }): string;
  /**
   * Compiles the swap with the settlement authority as fee payer, after
   * running it: a swap that would fail is refused here rather than after the
   * Consumer has confirmed it.
   */
  compile(params: {
    instructions: TransactionInstruction[];
    lookupTables: AddressLookupTableAccount[];
  }): Promise<CompiledSwap>;
}
