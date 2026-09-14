import {
  UnifiedSnapshotSchema,
  UnifiedQuoteSchema,
  unifiedMoney,
} from "../unified-fiat";
const snapshot = {
  mode: "simulation",
  holdings: {
    NGN: { settledMinor: "50000000", reservedMinor: "0" },
    USDC: { settledMinor: "100000000", reservedMinor: "0" },
  },
  total: {
    currency: "USD",
    decimals: 2,
    totalMinor: "40000",
    availableMinor: "40000",
    estimate: true,
  },
  orders: [],
};
describe("unified test balance contracts", () => {
  it("keeps source holdings separate from display valuation", () => {
    const parsed = UnifiedSnapshotSchema.parse(snapshot);
    expect(parsed.holdings.NGN.settledMinor).toBe("50000000");
    expect(unifiedMoney(parsed.total.totalMinor, parsed.total.currency)).toBe(
      "400.00 USD"
    );
    expect(unifiedMoney("1", "USDC")).toBe("0.000001 USDC");
    expect(unifiedMoney("123456789012345678", "NGN")).toBe(
      "1234567890123456.78 NGN"
    );
  });
  it("rejects live evidence and inexact accounting units", () => {
    expect(
      UnifiedSnapshotSchema.safeParse({ ...snapshot, mode: "production" })
        .success
    ).toBe(false);
    expect(
      UnifiedSnapshotSchema.safeParse({
        ...snapshot,
        total: { ...snapshot.total, estimate: false },
      }).success
    ).toBe(false);
    expect(
      UnifiedSnapshotSchema.safeParse({
        ...snapshot,
        holdings: {
          ...snapshot.holdings,
          NGN: { settledMinor: 50000000, reservedMinor: "0" },
        },
      }).success
    ).toBe(false);
  });
  it("rejects quotes without a complete funded plan or valid expiry", () => {
    expect(
      UnifiedQuoteSchema.safeParse({
        id: "q",
        mode: "simulation",
        destination: "test-wallet",
        expiresAt: "tomorrow",
        plan: { recipientMinor: "400000000" },
      }).success
    ).toBe(false);
  });
});
