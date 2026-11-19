import {
  formatCodeRate,
  formatCurrencyAmount,
  formatLocalAmount,
  formatRateLabel,
  startingPrice,
} from "@/utils/displayRates";

describe("formatCodeRate", () => {
  it("writes the rate from whichever side is at least one", () => {
    expect(formatCodeRate("NGN", 1530.25)).toBe("1 USD = 1,530.25 NGN");
    expect(formatCodeRate("GBP", 0.758)).toBe("1 GBP = 1.32 USD");
    expect(formatCodeRate("JPY", 159.29)).toBe("1 USD = 159 JPY");
  });
});

describe("formatCurrencyAmount", () => {
  it("uses each currency's own minor units", () => {
    expect(formatCurrencyAmount(1932.321, "NGN")).toBe("1,932.32");
    expect(formatCurrencyAmount(1932.5, "JPY")).toBe("1,933");
  });
});

describe("formatRateLabel", () => {
  it("leads with the local currency when it is worth more than a dollar", () => {
    expect(formatRateLabel("£", 0.758)).toBe("£1 = $1.32");
  });

  it("leads with the dollar when the local currency is worth less", () => {
    expect(formatRateLabel("₦", 1530.25)).toBe("$1 = ₦1,530.25");
  });

  it("reads one to one at parity", () => {
    expect(formatRateLabel("$", 1)).toBe("$1 = $1.00");
  });
});

describe("formatLocalAmount", () => {
  it("converts dollars into the local currency", () => {
    expect(formatLocalAmount("£", 100, 0.758)).toBe("£75.80");
  });

  it("groups thousands", () => {
    expect(formatLocalAmount("₦", 12.5, 1530.25)).toBe("₦19,128.13");
  });

  it("shows zero as zero", () => {
    expect(formatLocalAmount("£", 0, 0.758)).toBe("£0.00");
  });
});

describe("currencies written differently", () => {
  it("drops the decimals for the yen", () => {
    expect(formatRateLabel("¥", 159.29, "JPY")).toBe("$1 = ¥159");
    expect(formatLocalAmount("¥", 10, 159.29, "JPY")).toBe("¥1,593");
  });

  it("spaces a symbol made of letters", () => {
    expect(formatRateLabel("KES", 130.01, "KES")).toBe("$1 = KES 130.01");
    expect(formatLocalAmount("KSh", 10, 130.01, "KES")).toBe("KSh 1,300.10");
  });

  it("keeps a symbol that ends in a sign tight", () => {
    expect(formatLocalAmount("GH₵", 10, 11.73, "GHS")).toBe("GH₵117.30");
  });
});

describe("minor units by currency", () => {
  it("writes every zero-decimal currency without decimals", () => {
    expect(formatLocalAmount("FBu", 10, 2950.5, "BIF")).toBe("FBu 29,505");
    expect(formatLocalAmount("Fdj", 10, 177.7, "DJF")).toBe("Fdj 1,777");
  });

  it("writes three-decimal currencies with three", () => {
    expect(formatLocalAmount("KD", 10, 0.3071, "KWD")).toBe("KD 3.071");
  });
});

describe("startingPrice", () => {
  it("opens on a price that converts to more than a few cents", () => {
    expect(startingPrice(0.758)).toBe("1");
    expect(startingPrice(3.6725)).toBe("1");
    expect(startingPrice(33.89)).toBe("100");
    expect(startingPrice(1530.25)).toBe("10,000");
  });
});
