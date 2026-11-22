import {
  formatDollarsMinor,
  formatNaira,
  formatRate,
  rampCounterparty,
  shortBankName,
  type RampDetails,
} from "@/utils/ramp";
import { arrivalLabel } from "@/utils/activity";
import type { TransferRow } from "@/utils/apiClient";

const send: RampDetails = {
  orderId: "o",
  direction: "send",
  fiatCurrency: "NGN",
  fiatAmountMinor: "500000",
  fiatDecimals: 2,
  rate: "1432.92",
  feeMinor: "23463",
  counterpartyName: "Ada Okafor",
  bankName: "Kuda Microfinance Bank",
  bankCode: "KUDANGPC",
  logoKey: "kuda",
  accountLast4: "6789",
};

describe("ramp formatting", () => {
  it("shows naira without empty kobo", () => {
    expect(formatNaira("1000000", 2)).toBe("₦10,000");
    expect(formatNaira("1000050", 2)).toBe("₦10,000.50");
  });

  it("cuts dollars to cents rather than rounding up", () => {
    expect(formatDollarsMinor("6904024", 6)).toBe("$6.90");
    expect(formatDollarsMinor("1234567890000", 6)).toBe("$1,234,567.89");
  });

  it("groups the rate", () => {
    expect(formatRate("1448.43")).toBe("₦1,448.43");
  });

  it("shortens bank names for a row", () => {
    expect(shortBankName("Kuda Microfinance Bank")).toBe("Kuda");
    expect(shortBankName("Guaranty Trust Bank")).toBe("Guaranty Trust");
    expect(shortBankName("Bank")).toBe("Bank");
  });

  it("names the person and bank of a send", () => {
    expect(rampCounterparty(send)).toBe("Ada Okafor · Kuda");
    expect(rampCounterparty({ ...send, bankName: null })).toBe("Ada Okafor");
    expect(rampCounterparty({ ...send, direction: "receive" })).toBe(
      "Bank transfer"
    );
  });
});

describe("arrival toast for a naira deposit", () => {
  it("says the naira, not the token amount", () => {
    const row = {
      mint: "usdc",
      amountRaw: "6904024",
      decimals: 6,
      tokenSymbol: "USDC",
      tokenName: "USD Coin",
      ramp: { ...send, direction: "receive", fiatAmountMinor: "1000000" },
    } as unknown as TransferRow;
    expect(arrivalLabel(row)).toBe("Received ₦10,000");
  });
});
