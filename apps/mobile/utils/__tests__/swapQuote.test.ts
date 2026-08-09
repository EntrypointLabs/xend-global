import {
  formatRawAmount,
  isQuoteExpired,
  selectBestRoute,
  type SwapQuote,
} from "@/utils/swapQuote";

const route = (
  overrides: Record<string, unknown> = {},
  kind = "svm_versioned_tx"
) => ({
  quoteId: "0xabc",
  expiresAt: 1_785_985_788,
  slippage: 1,
  estimatedTime: 30,
  output: { amount: "7326955", minAmountOut: "7253685" },
  routeDetails: { dexDetails: { protocol: { name: "bitget" } } },
  txData: { kind, object: { data: "3xQm" } },
  statusCheck: { endpoint: "https://example.test/status" },
  ...overrides,
});

describe("selectBestRoute", () => {
  it("returns null when nothing is on offer", () => {
    expect(selectBestRoute([])).toBeNull();
  });

  it("picks the route paying out the most", () => {
    const best = selectBestRoute([
      route({ quoteId: "low", output: { amount: "100", minAmountOut: "99" } }),
      route({
        quoteId: "high",
        output: { amount: "300", minAmountOut: "290" },
      }),
      route({ quoteId: "mid", output: { amount: "200", minAmountOut: "190" } }),
    ]);
    expect(best?.quoteId).toBe("high");
  });

  it("compares amounts as integers, not as strings", () => {
    // "9" sorts above "10" lexically, which would pick the smaller payout.
    const best = selectBestRoute([
      route({ quoteId: "nine", output: { amount: "9", minAmountOut: "9" } }),
      route({ quoteId: "ten", output: { amount: "10", minAmountOut: "10" } }),
    ]);
    expect(best?.quoteId).toBe("ten");
  });

  it("survives amounts beyond a float's precision", () => {
    const best = selectBestRoute([
      route({
        quoteId: "a",
        output: { amount: "9007199254740993", minAmountOut: "1" },
      }),
      route({
        quoteId: "b",
        output: { amount: "9007199254740992", minAmountOut: "1" },
      }),
    ]);
    expect(best?.quoteId).toBe("a");
  });

  it("drops routes whose transaction shape is unrecognised", () => {
    // A price the Consumer cannot act on is worse than showing no price.
    expect(selectBestRoute([route({}, "evm_tx")])).toBeNull();
  });

  it("prefers a usable route over a larger unusable one", () => {
    const best = selectBestRoute([
      route({ quoteId: "unusable", output: { amount: "999" } }, "evm_tx"),
      route({ quoteId: "usable", output: { amount: "100" } }),
    ]);
    expect(best?.quoteId).toBe("usable");
  });

  it("reads both Solana transaction encodings", () => {
    expect(selectBestRoute([route({})])?.txKind).toBe("versioned");
    expect(selectBestRoute([route({}, "svm_instructions")])?.txKind).toBe(
      "instructions"
    );
  });

  it("ignores a route with no amount at all", () => {
    expect(selectBestRoute([route({ output: {} })])).toBeNull();
  });

  it("drops a route carrying no transaction payload", () => {
    // txData.data is always null on the wire; the payload is under `object`.
    expect(
      selectBestRoute([route({ txData: { kind: "svm_versioned_tx" } })])
    ).toBeNull();
  });

  it("passes the payload through untouched", () => {
    expect(selectBestRoute([route({})])?.txPayload).toBe("3xQm");
  });
});

describe("isQuoteExpired", () => {
  const at = (expiresAt: number) => ({ expiresAt }) as SwapQuote;

  it("expires early enough to finish signing", () => {
    // Live at 11s out, dead at 10s: the buffer is what stops a quote dying
    // between the tap and the signature.
    const expiry = 1_000_000;
    expect(isQuoteExpired(at(expiry), (expiry - 11) * 1000)).toBe(false);
    expect(isQuoteExpired(at(expiry), (expiry - 10) * 1000)).toBe(true);
  });

  it("treats a missing expiry as open ended", () => {
    expect(isQuoteExpired(at(0), Date.now())).toBe(false);
  });
});

describe("formatRawAmount", () => {
  it("shifts the decimal without going through a float", () => {
    expect(formatRawAmount("7326955", 6)).toBe("7.326955");
    expect(formatRawAmount("100000000", 9)).toBe("0.1");
  });

  it("trims trailing zeros but keeps significant ones", () => {
    expect(formatRawAmount("1500000", 6)).toBe("1.5");
    expect(formatRawAmount("1000000", 6)).toBe("1");
    expect(formatRawAmount("1000001", 6)).toBe("1.000001");
  });

  it("pads amounts smaller than one unit", () => {
    expect(formatRawAmount("5", 6)).toBe("0.000005");
    expect(formatRawAmount("0", 6)).toBe("0");
  });

  it("groups thousands", () => {
    expect(formatRawAmount("2847500000", 6)).toBe("2,847.5");
  });

  it("keeps precision a float would lose", () => {
    expect(formatRawAmount("9007199254740993", 0)).toBe(
      "9,007,199,254,740,993"
    );
  });
});
