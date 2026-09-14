import { fiatAmountMinor, fiatMoneyLabel, FiatQuoteSchema } from "../fiat";

describe("fiat contract boundaries", () => {
  it("converts exactly without floating point rounding", () => {
    expect(fiatAmountMinor("123456789012345.67", 2)).toBe("12345678901234567");
    expect(fiatAmountMinor("0.000001", 6)).toBe("1");
    expect(fiatAmountMinor("0001.20", 2)).toBe("120");
  });
  it("rejects amounts that would need rounding or coercion", () => {
    for (const v of ["0", "-1", "1e3", "NaN", "1.001", " 1", "1,000", ".5"])
      expect(fiatAmountMinor(v, 2)).toBeNull();
  });
  it("formats tiny amounts exactly", () => {
    expect(
      fiatMoneyLabel({ currency: "USDC", amountMinor: "1", decimals: 6 })
    ).toBe("0.000001 USDC");
  });
  it("rejects unknown field types and empty select choices", () => {
    const shape = FiatQuoteSchema.shape.fields;
    expect(
      shape.safeParse([
        { key: "x", label: "x", required: true, type: "javascript" },
      ]).success
    ).toBe(false);
    expect(
      shape.safeParse([
        { key: "x", label: "x", required: true, type: "select", options: [] },
      ]).success
    ).toBe(false);
  });
});
