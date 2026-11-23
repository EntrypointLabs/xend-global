import { formatRawAmountShort, toAmountInput, toRawAmount } from "@/utils/swap";

describe("toRawAmount", () => {
  it("turns a typed amount into the smallest unit exactly", () => {
    expect(toRawAmount("1.5", 6)).toBe("1500000");
    expect(toRawAmount("0.000000001", 9)).toBe("1");
    expect(toRawAmount("3.250000001", 9)).toBe("3250000001");
    expect(toRawAmount("12", 0)).toBe("12");
  });

  it("drops digits finer than the token goes", () => {
    expect(toRawAmount("1.23456789", 6)).toBe("1234567");
  });

  it("reads nothing typed, or a bare point, as nothing", () => {
    expect(toRawAmount("0", 6)).toBe("0");
    expect(toRawAmount("0.", 6)).toBe("0");
    expect(toRawAmount(".", 6)).toBe("0");
  });

  it("keeps an amount too large for a float", () => {
    expect(toRawAmount("9007199254740993.000000001", 9)).toBe(
      "9007199254740993000000001"
    );
  });
});

describe("toAmountInput", () => {
  it("writes a whole balance the way the keypad would", () => {
    expect(toAmountInput("2847500000", 6)).toBe("2847.5");
    expect(toAmountInput("3250000001", 9)).toBe("3.250000001");
  });

  it("round-trips with toRawAmount", () => {
    expect(toRawAmount(toAmountInput("3250000001", 9), 9)).toBe("3250000001");
  });
});

describe("formatRawAmountShort", () => {
  it("cuts a long balance to four places", () => {
    expect(formatRawAmountShort("3250000001", 9)).toBe("3.25");
    expect(formatRawAmountShort("2847512345", 6)).toBe("2,847.5123");
  });

  it("never rounds up past what is held", () => {
    expect(formatRawAmountShort("3999990000", 9)).toBe("3.9999");
  });

  it("shows a whole balance without a point", () => {
    expect(formatRawAmountShort("5000000", 6)).toBe("5");
  });
});
