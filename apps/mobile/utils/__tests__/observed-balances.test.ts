import { ObservedBalancesSchema } from "../observed-balances";
const observedAt = "2026-09-09T21:00:00.000Z";
const response = {
  mode: "observed",
  bankEnvironment: "sandbox",
  network: "devnet",
  holdings: [
    {
      currency: "NGN",
      decimals: 2,
      status: "available",
      amountMinor: "50000000",
      observedAt,
      reason: null,
    },
    {
      currency: "USDC",
      decimals: 6,
      status: "available",
      amountMinor: "100000000",
      observedAt,
      reason: null,
    },
  ],
  total: {
    currency: "USD",
    amountMinor: "40000",
    estimate: true,
    asOf: observedAt,
  },
  valuationReason: null,
};
describe("observed balances contract", () => {
  it("accepts both observed holdings and estimate", () => {
    expect(ObservedBalancesSchema.safeParse(response).success).toBe(true);
  });
  it("rejects totals when a holding is missing or environments differ", () => {
    expect(
      ObservedBalancesSchema.safeParse({ ...response, network: "mainnet" })
        .success
    ).toBe(false);
    expect(
      ObservedBalancesSchema.safeParse({
        ...response,
        holdings: [
          response.holdings[0],
          {
            ...response.holdings[1],
            status: "unavailable",
            amountMinor: null,
            observedAt: null,
          },
        ],
      }).success
    ).toBe(false);
  });
  it("preserves unavailable amounts rather than silently replacing them with zero", () => {
    const partial = {
      ...response,
      total: null,
      holdings: [
        response.holdings[0],
        {
          ...response.holdings[1],
          status: "unavailable",
          amountMinor: null,
          observedAt: null,
        },
      ],
    };
    expect(
      ObservedBalancesSchema.parse(partial).holdings[1].amountMinor
    ).toBeNull();
    expect(
      ObservedBalancesSchema.safeParse({
        ...partial,
        holdings: [
          partial.holdings[0],
          { ...partial.holdings[1], amountMinor: "0" },
        ],
      }).success
    ).toBe(false);
  });
});
