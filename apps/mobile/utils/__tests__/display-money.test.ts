import { displayMoney } from "@/utils/display-money";

describe("displayMoney", () => {
  it("writes naira with its symbol and grouping", () => {
    expect(displayMoney("NGN", "38542050")).toBe("₦385,420.50");
    expect(displayMoney("NGN", "1500000")).toBe("₦15,000");
  });
  it("writes USD with a symbol", () => {
    expect(displayMoney("USD", "310445")).toBe("$3,104.45");
  });
  it("shows USDC at two places without rounding up", () => {
    expect(displayMoney("USDC", "2847500000")).toBe("2,847.50 USDC");
    expect(displayMoney("USDC", "33333333")).toBe("33.33 USDC");
    expect(displayMoney("USDC", "999999")).toBe("0.99 USDC");
  });
});
