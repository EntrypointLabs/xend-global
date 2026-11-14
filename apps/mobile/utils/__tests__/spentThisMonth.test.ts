import { summariseMonthlyFlow, summariseMonthlySpend } from "../spentThisMonth";
import type { ActivityEntry } from "../activity";

function entry(over: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: "1",
    direction: "send",
    status: "confirmed",
    kind: "transfer",
    merchantName: null,
    mint: "m",
    amountRaw: "1",
    decimals: 6,
    self: "a",
    counterparty: "b",
    signature: null,
    usdValue: "10.00",
    memo: null,
    createdAt: "2026-11-05T12:00:00",
    confirmedAt: null,
    ...over,
  };
}

const now = new Date("2026-11-14T12:00:00");

describe("summariseMonthlySpend", () => {
  it("sums this month's sends and payments", () => {
    const result = summariseMonthlySpend(
      [
        entry({ id: "a", usdValue: "10.00" }),
        entry({ id: "b", kind: "payment", usdValue: "2.50" }),
      ],
      now
    );
    expect(result.totalUsd).toBeCloseTo(12.5);
    expect(result.cumulative).toHaveLength(15);
    expect(result.cumulative[4]).toBe(0);
    expect(result.cumulative[5]).toBeCloseTo(12.5);
  });

  it("ignores receives, failures, unpriced rows and other months", () => {
    const result = summariseMonthlySpend(
      [
        entry({ id: "a", direction: "receive" }),
        entry({ id: "b", status: "failed" }),
        entry({ id: "c", usdValue: null }),
        entry({ id: "d", createdAt: "2026-10-30T12:00:00" }),
        entry({ id: "e", kind: "security" }),
      ],
      now
    );
    expect(result.totalUsd).toBe(0);
  });
});

describe("summariseMonthlyFlow", () => {
  it("splits this month's money into in and out", () => {
    const result = summariseMonthlyFlow(
      [
        entry({ id: "a", direction: "receive", usdValue: "250.00" }),
        entry({ id: "b", kind: "payment", usdValue: "18.75" }),
        entry({ id: "c", usdValue: "120.00" }),
      ],
      now
    );
    expect(result.inUsd).toBeCloseTo(250);
    expect(result.outUsd).toBeCloseTo(138.75);
  });

  it("skips failures, unpriced rows, other months and events", () => {
    const result = summariseMonthlyFlow(
      [
        entry({ id: "a", direction: "receive", status: "failed" }),
        entry({ id: "b", usdValue: null }),
        entry({ id: "c", createdAt: "2026-10-30T12:00:00" }),
        entry({ id: "d", kind: "security" }),
      ],
      now
    );
    expect(result).toEqual({ inUsd: 0, outUsd: 0 });
  });
});
