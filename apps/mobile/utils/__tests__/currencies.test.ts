import { currencyCountry, currencyName } from "@/utils/currencies";

describe("currencyName", () => {
  it("names a currency in full", () => {
    expect(currencyName("GBP")).toBe("British pound");
    expect(currencyName("NGN")).toBe("Nigerian naira");
  });

  it("falls back to the code for one it does not know", () => {
    expect(currencyName("ABC")).toBe("ABC");
  });
});

describe("currencyCountry", () => {
  it("uses the country the code starts with", () => {
    expect(currencyCountry("NGN")).toBe("ng");
    expect(currencyCountry("GBP")).toBe("gb");
  });

  it("maps shared currencies to a member country", () => {
    expect(currencyCountry("EUR")).toBe("eu");
    expect(currencyCountry("XOF")).toBe("sn");
  });

  it("has no flag for a currency without a country", () => {
    expect(currencyCountry("XDR")).toBeNull();
  });
});
