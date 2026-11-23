import { formatUsdcRaw, groupThousands } from "@/utils/spendingLimit";

jest.mock("@/utils/cluster", () => ({ getUsdcMint: () => "usdc-mint" }));

describe("formatUsdcRaw", () => {
  it("groups thousands without leaning on the locale", () => {
    expect(formatUsdcRaw("1000000000")).toBe("$1,000");
    expect(formatUsdcRaw("1234567000000")).toBe("$1,234,567");
  });

  it("leaves round amounts without cents", () => {
    expect(formatUsdcRaw("100000000")).toBe("$100");
  });

  it("always shows two places when there are cents", () => {
    expect(formatUsdcRaw("742500000")).toBe("$742.50");
    expect(formatUsdcRaw("12050000")).toBe("$12.05");
  });

  it("keeps precision beyond cents rather than rounding it away", () => {
    expect(formatUsdcRaw("1000001")).toBe("$1.000001");
  });
});

describe("groupThousands", () => {
  it("leaves short runs alone", () => {
    expect(groupThousands("999")).toBe("999");
    expect(groupThousands("1000")).toBe("1,000");
  });
});
