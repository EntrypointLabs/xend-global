/// <reference types="jest" />
import type { TransferRow } from "@/utils/apiClient";
import { selectBalanceHistory } from "@/utils/balanceHistory";

const USDC = "UsdcMint00000000000000000000000000000000000";
const SOL = "So11111111111111111111111111111111111111112";

const NOW = Date.parse("2026-08-19T18:00:00.000Z");
const DEPOSIT_AT = Date.parse("2026-08-19T13:16:49.000Z");

function row(overrides: Partial<TransferRow> = {}): TransferRow {
  return {
    id: "t1",
    direction: "RECEIVE",
    mint: USDC,
    amountRaw: "20000000",
    fromAddress: "someone",
    toAddress: "us",
    status: "CONFIRMED",
    signature: "sig-1",
    memo: null,
    kind: "transfer",
    merchantName: null,
    createdAt: new Date(DEPOSIT_AT).toISOString(),
    confirmedAt: new Date(DEPOSIT_AT).toISOString(),
    ...overrides,
  } as TransferRow;
}

const inputs = {
  currentTotal: 429.57,
  pricesByMint: { [USDC]: 1, [SOL]: 81.914 },
  decimalsByMint: { [USDC]: 6, [SOL]: 9 },
  now: NOW,
};

describe("selectBalanceHistory", () => {
  it("anchors the latest point to the portfolio total, not the cash balance", () => {
    const points = selectBalanceHistory([row()], inputs);
    expect(points[points.length - 1]).toEqual({ at: NOW, value: 429.57 });
  });

  it("undoes a deposit to recover the value before it", () => {
    const points = selectBalanceHistory([row()], inputs);
    // 429.57 today, and the 20 USDC deposit is what took it there.
    const beforeDeposit = points.find((p) => p.at === DEPOSIT_AT - 1);
    expect(beforeDeposit?.value).toBeCloseTo(409.57, 2);
  });

  it("values a non-USDC transfer at its own mint's price and decimals", () => {
    const points = selectBalanceHistory(
      [row({ mint: SOL, amountRaw: "1000000000", signature: "sig-sol" })],
      inputs
    );
    // 1 SOL at 81.914 undone from the total.
    expect(points[0].value).toBeCloseTo(429.57 - 81.914, 2);
  });

  it("skips a mint it cannot price rather than inventing a cliff", () => {
    const points = selectBalanceHistory(
      [row({ mint: "UnpriceableMint", signature: "sig-x" })],
      inputs
    );
    expect(points).toEqual([]);
  });

  it("ignores transfers that never confirmed", () => {
    const points = selectBalanceHistory([row({ status: "PENDING" })], inputs);
    expect(points).toEqual([]);
  });

  it("clamps at zero when the loaded rows over-explain the balance", () => {
    // An inflow larger than everything held: the matching outflow is not in
    // the loaded set, so undoing it alone would drive the line negative.
    const points = selectBalanceHistory(
      [row({ amountRaw: "999000000000" })],
      inputs
    );
    expect(points.every((p) => p.value >= 0)).toBe(true);
  });

  it("returns nothing when there are no transfers to walk", () => {
    expect(selectBalanceHistory([], inputs)).toEqual([]);
  });

  it("orders points oldest to newest", () => {
    const points = selectBalanceHistory(
      [
        row(),
        row({
          signature: "sig-2",
          createdAt: new Date(DEPOSIT_AT - 60_000).toISOString(),
          confirmedAt: new Date(DEPOSIT_AT - 60_000).toISOString(),
        }),
      ],
      inputs
    );
    const times = points.map((p) => p.at);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("values a sold-out asset from the row, not from current holdings", () => {
    // Convert every SOL to USDC and the holdings map knows nothing about SOL,
    // which used to drop the movement from the line entirely.
    const points = selectBalanceHistory(
      [row({ mint: SOL, amountRaw: "1000000000", usdValue: "81.91" })],
      { ...inputs, pricesByMint: {}, decimalsByMint: {} }
    );
    expect(points[0].value).toBeCloseTo(429.57 - 81.91, 2);
  });

  it("still prices an older row from current holdings", () => {
    const points = selectBalanceHistory(
      [row({ mint: SOL, amountRaw: "1000000000", signature: "sig-old" })],
      inputs
    );
    expect(points[0].value).toBeCloseTo(429.57 - 81.914, 2);
  });
});
