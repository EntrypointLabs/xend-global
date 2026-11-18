import { formatLocalAmount, formatRateLabel } from "@/utils/displayRates";

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
