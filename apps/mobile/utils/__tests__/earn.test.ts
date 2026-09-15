import { earnHeadlineApy, EARN_PRODUCTS } from "@/hooks/useEarn";

describe("earnHeadlineApy", () => {
  it("quotes the best rate actually on offer", () => {
    const best = Math.max(
      ...EARN_PRODUCTS.map((product) => Number.parseFloat(product.apyDisplay))
    );
    expect(earnHeadlineApy()).toBe(`${best.toFixed(2)}%`);
  });

  it("never advertises a rate no product pays", () => {
    const quoted = EARN_PRODUCTS.map((product) => product.apyDisplay);
    expect(quoted).toContain(earnHeadlineApy());
  });
});
