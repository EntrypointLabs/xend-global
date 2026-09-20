import { describe, expect, it } from "vitest";
import { formatDisplayAmount, formatUsdc } from "./money";

describe("formatDisplayAmount", () => {
  it("formats common two-decimal currencies with a symbol", () => {
    expect(formatDisplayAmount("USD", "4217")).toBe("$42.17");
    expect(formatDisplayAmount("NGN", "100000")).toBe("₦1,000.00");
  });

  it("keeps precision beyond the safe-integer range instead of coercing to Infinity", () => {
    // 99,999,999,999,999,999 minor units is past Number.MAX_SAFE_INTEGER; the
    // old Number(minor)/100 path would have lost digits or produced Infinity.
    expect(formatDisplayAmount("USD", "99999999999999999")).toBe(
      "$999,999,999,999,999.99",
    );
  });

  it("falls back to the code for an unknown currency without throwing", () => {
    expect(formatDisplayAmount("ZZZ", "1234")).toBe("ZZZ 12.34");
  });

  it("handles a malformed minor value without throwing", () => {
    expect(formatDisplayAmount("USD", "not-a-number")).toBe("USD not-a-number");
  });
});

describe("formatUsdc", () => {
  it("still formats six-decimal USDC", () => {
    expect(formatUsdc("751544", { suffix: true })).toBe("0.751544 USDC");
  });
});
