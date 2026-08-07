/**
 * Swap quotes from Socket (the aggregator behind Bungee).
 *
 * Same-chain Solana is supported but undocumented: the published guides only
 * cover cross-chain, and the same-chain page lists EVM DEXes that never serve a
 * Solana route. Everything here was read off live responses rather than docs,
 * so treat the shapes as observed behaviour and fail soft when they drift.
 *
 * The public endpoint needs no API key, which is why this can run on the client
 * at all. A keyed tier exists for fee-taking and Socket requires those keys to
 * stay server-side, so adding a fee later means moving this behind the backend.
 */

const QUOTE_ENDPOINT = "https://public-backend.socket.tech/v3/swap/quote";

/** Socket's identifier for Solana. Not the 7565164 other bridges use. */
export const SOLANA_CHAIN_ID = 89999;

export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

/** Seconds of headroom before `expiresAt`, so a quote cannot die mid-signature. */
const EXPIRY_BUFFER_SECONDS = 10;

/**
 * How the transaction arrived.
 *
 * `versioned` is a fully serialised, base58, already partially signed
 * transaction: its message must not be rebuilt or its co-signature is
 * invalidated. `instructions` has to be assembled into a VersionedTransaction
 * locally. Which one comes back varies per request for the same pair, so both
 * have to be handled.
 */
export type SwapTxKind = "versioned" | "instructions";

export interface SwapQuote {
  quoteId: string;
  /** Raw integer string at the output token's decimals. */
  outAmountRaw: string;
  /** Guaranteed floor after slippage, raw. */
  minOutAmountRaw: string;
  /** Unix seconds. */
  expiresAt: number;
  /** The venue that priced it, for display. */
  provider: string | null;
  slippage: number;
  estimatedTimeSeconds: number | null;
  txKind: SwapTxKind;
  /**
   * `txData.object.data`, exactly as returned. A base58 string for `versioned`,
   * an instruction set for `instructions`. Passed through untouched because
   * the versioned form is already partially signed and any re-encoding would
   * invalidate the co-signature.
   */
  txPayload: unknown;
  statusEndpoint: string | null;
}

export class SwapQuoteError extends Error {}

interface QuoteParams {
  inputMint: string;
  outputMint: string;
  /** Raw integer string at the input token's decimals. */
  amountRaw: string;
  userAddress: string;
  /** Percent, e.g. 1 for 1%. Omitted entirely to let Socket choose. */
  slippagePercent?: number;
  signal?: AbortSignal;
}

export async function fetchSwapQuote({
  inputMint,
  outputMint,
  amountRaw,
  userAddress,
  slippagePercent,
  signal,
}: QuoteParams): Promise<SwapQuote> {
  if (inputMint === outputMint) {
    throw new SwapQuoteError("Choose two different tokens");
  }

  const params = new URLSearchParams({
    userOps: "tx",
    originChainId: String(SOLANA_CHAIN_ID),
    destinationChainId: String(SOLANA_CHAIN_ID),
    inputToken: inputMint,
    outputToken: outputMint,
    inputAmount: amountRaw,
    userAddress,
    // Same wallet receives; Socket rejects a Solana quote without it.
    receiverAddress: userAddress,
  });
  if (slippagePercent != null) {
    params.append("slippage", String(slippagePercent));
  }

  const response = await fetch(`${QUOTE_ENDPOINT}?${params}`, { signal });
  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.success) {
    throw new SwapQuoteError(
      typeof body?.message === "string" ? body.message : "No route available"
    );
  }

  const routes = Array.isArray(body.result?.routes) ? body.result.routes : [];
  const quote = selectBestRoute(routes);
  if (!quote) throw new SwapQuoteError("No route available");
  return quote;
}

/**
 * Picks the route paying out the most.
 *
 * Routes whose shape is unrecognised are dropped rather than surfaced: a quote
 * that cannot later be turned into a transaction is worse than no quote,
 * because the Consumer would see a price they cannot act on.
 */
export function selectBestRoute(routes: unknown[]): SwapQuote | null {
  const usable = routes
    .map(toQuote)
    .filter((quote): quote is SwapQuote => quote !== null);
  if (usable.length === 0) return null;

  return usable.reduce((best, candidate) =>
    BigInt(candidate.outAmountRaw) > BigInt(best.outAmountRaw)
      ? candidate
      : best
  );
}

function toQuote(route: any): SwapQuote | null {
  const outAmountRaw = route?.output?.amount;
  const quoteId = route?.quoteId;
  if (typeof outAmountRaw !== "string" || typeof quoteId !== "string") {
    return null;
  }

  const txKind = readTxKind(route?.txData?.kind);
  // The transaction lives under `object`, not directly on txData, where the
  // `data` key exists but is always null.
  const txPayload = route?.txData?.object?.data;
  if (!txKind || txPayload == null) return null;

  return {
    quoteId,
    txKind,
    txPayload,
    outAmountRaw,
    minOutAmountRaw:
      typeof route?.output?.minAmountOut === "string"
        ? route.output.minAmountOut
        : outAmountRaw,
    expiresAt: typeof route?.expiresAt === "number" ? route.expiresAt : 0,
    provider: route?.routeDetails?.dexDetails?.protocol?.name ?? null,
    slippage: typeof route?.slippage === "number" ? route.slippage : 0,
    estimatedTimeSeconds:
      typeof route?.estimatedTime === "number" ? route.estimatedTime : null,
    statusEndpoint:
      typeof route?.statusCheck?.endpoint === "string"
        ? route.statusCheck.endpoint
        : null,
  };
}

function readTxKind(kind: unknown): SwapTxKind | null {
  if (kind === "svm_versioned_tx") return "versioned";
  if (kind === "svm_instructions") return "instructions";
  return null;
}

export function isQuoteExpired(quote: SwapQuote, nowMs: number): boolean {
  if (!quote.expiresAt) return false;
  return quote.expiresAt - EXPIRY_BUFFER_SECONDS <= Math.floor(nowMs / 1000);
}

/** Raw integer string to display units, without going through a float. */
export function formatRawAmount(raw: string, decimals: number): string {
  const negative = raw.startsWith("-");
  const digits = (negative ? raw.slice(1) : raw).padStart(decimals + 1, "0");
  const whole = digits
    .slice(0, digits.length - decimals)
    .replace(/^0+(?=\d)/, "");
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  // Grouped by string surgery. toLocaleString would route through a float and
  // silently round token amounts past 2^53.
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}
