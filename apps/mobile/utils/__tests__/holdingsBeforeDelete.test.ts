/// <reference types="jest" />
import type { TokenBalance } from "@/utils/apiClient";
import { holdingsBeforeDelete } from "@/utils/balances";
import { getUsdcMint } from "@/utils/cluster";

const SOL = "So11111111111111111111111111111111111111112";

const token = (
  mint: string,
  amountRaw: string,
  decimals: number,
  usdValue: number | null
): TokenBalance => ({ mint, amountRaw, decimals, symbol: null, usdValue });

describe("holdingsBeforeDelete", () => {
  it("counts SOL alongside dollars, not dollars alone", () => {
    const held = holdingsBeforeDelete(
      [token(getUsdcMint(), "700000", 6, 0.7), token(SOL, "46200000", 9, 3.21)],
      0
    );
    expect(held.usd).toBeCloseTo(3.91);
    expect(held.holdsAnything).toBe(true);
  });

  it("counts what sits in Earn", () => {
    const held = holdingsBeforeDelete([], 12.5);
    expect(held).toEqual({ usd: 12.5, holdsAnything: true });
  });

  it("refuses for a holding nothing could price", () => {
    const held = holdingsBeforeDelete([token("Unpriced111", "5", 0, null)], 0);
    expect(held).toEqual({ usd: 0, holdsAnything: true });
  });

  it("allows deletion only when everything is empty", () => {
    const held = holdingsBeforeDelete(
      [token(getUsdcMint(), "0", 6, 0), token(SOL, "0", 9, 0)],
      0
    );
    expect(held).toEqual({ usd: 0, holdsAnything: false });
  });
});
