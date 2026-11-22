import {
  formatDollarsMinor,
  formatNaira,
  formatRate,
  rampCounterparty,
  rampOutcome,
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

  it("names the person of a send, leaving the bank to its logo", () => {
    expect(rampCounterparty(send)).toBe("Ada Okafor");
    expect(rampCounterparty({ ...send, counterpartyName: null })).toBe("Kuda");
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

describe("sub-cent dollars", () => {
  it("keeps a real movement under a cent instead of $0.00", () => {
    expect(formatDollarsMinor("5000", 6)).toBe("$0.005");
    expect(formatDollarsMinor("1234", 6)).toBe("$0.0012");
    expect(formatDollarsMinor("0", 6)).toBe("$0.00");
    expect(formatDollarsMinor("10000", 6)).toBe("$0.01");
  });
});

describe("bank send outcome on the receipt", () => {
  it("reports the payout, not just the funding leg", () => {
    expect(
      rampOutcome({ ...send, orderStatus: "processing" }, "confirmed")
    ).toBe("processing");
    expect(rampOutcome({ ...send, orderStatus: "returned" }, "confirmed")).toBe(
      "refunded"
    );
    expect(
      rampOutcome({ ...send, orderStatus: "completed" }, "confirmed")
    ).toBe("completed");
  });

  it("leaves deposits and unconfirmed sends to the transfer status", () => {
    expect(
      rampOutcome(
        { ...send, direction: "receive", orderStatus: "processing" },
        "confirmed"
      )
    ).toBeNull();
    expect(
      rampOutcome({ ...send, orderStatus: "returned" }, "pending")
    ).toBeNull();
    expect(
      rampOutcome({ ...send, orderStatus: undefined }, "confirmed")
    ).toBeNull();
  });
});
