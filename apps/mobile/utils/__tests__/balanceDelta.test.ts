import { selectBalanceDelta } from "@/utils/balanceDelta";
import type { BalancePoint } from "@/components/ui/organisms/BalanceChart";

const NOW = Date.parse("2026-08-05T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const hoursAgo = (h: number) => NOW - h * HOUR;

const at = (h: number, value: number): BalancePoint => ({
  at: hoursAgo(h),
  value,
});

describe("selectBalanceDelta", () => {
  it("returns null without two points to compare", () => {
    expect(selectBalanceDelta([], NOW)).toBeNull();
    expect(selectBalanceDelta([at(0, 100)], NOW)).toBeNull();
  });

  it("measures against the balance a day ago, not the earliest point", () => {
    const history = [at(72, 50), at(25, 100), at(1, 110), at(0, 110)];
    expect(selectBalanceDelta(history, NOW)?.display).toBe("+10.00%");
  });

  it("signs a decline", () => {
    const history = [at(25, 200), at(0, 150)];
    expect(selectBalanceDelta(history, NOW)?.display).toBe("-25.00%");
  });

  it("reports no change without a sign", () => {
    const history = [at(25, 200), at(0, 200)];
    const delta = selectBalanceDelta(history, NOW);
    expect(delta?.fraction).toBe(0);
    expect(delta?.display).toBe("0.00%");
  });

  it("returns null when the prior balance was zero", () => {
    // A wallet funded from empty has no percentage change: the honest answer
    // is to show nothing rather than a division by zero.
    const history = [at(25, 0), at(0, 500)];
    expect(selectBalanceDelta(history, NOW)).toBeNull();
  });

  describe("a zero balance", () => {
    it("reports -100% once the wallet has held something", () => {
      const history = [at(48, 0), at(30, 800), at(2, 0), at(0, 0)];
      expect(selectBalanceDelta(history, NOW)?.display).toBe("-100.00%");
    });

    it("shows nothing when the wallet has never held anything", () => {
      const history = [at(48, 0), at(25, 0), at(0, 0)];
      expect(selectBalanceDelta(history, NOW)).toBeNull();
    });

    it("shows nothing when the baseline is negative", () => {
      // Replaying an incomplete transfer set can drive a reconstructed balance
      // below zero, which would otherwise divide out to a false -100%.
      const history = [at(30, -500), at(0, 0)];
      expect(selectBalanceDelta(history, NOW)).toBeNull();
    });
  });

  it("falls back to the oldest point when history is under a day old", () => {
    const history = [at(6, 100), at(0, 125)];
    expect(selectBalanceDelta(history, NOW)?.display).toBe("+25.00%");
  });
});
