import {
  FiatOrderSchema,
  fiatErrorCode,
  fiatErrorMessage,
  minorToPlain,
  nairaAllowanceLeft,
} from "../fiat";

describe("naira ramp helpers", () => {
  it("prints exact USDC for a transfer, without trailing zeros", () => {
    expect(minorToPlain("30100000", 6)).toBe("30.1");
    expect(minorToPlain("1", 6)).toBe("0.000001");
    expect(minorToPlain("5000000", 2)).toBe("50000");
  });

  it("never reports a negative allowance", () => {
    const limits = { verified: false, windowHours: 24, limitMinor: "5000000" };
    const used = { receive: "1200000", send: "9000000" };
    expect(nairaAllowanceLeft({ ...limits, used }, "receive")).toBe(3_800_000n);
    expect(nairaAllowanceLeft({ ...limits, used }, "send")).toBe(0n);
  });

  it("leaves the send allowance whole after a full day of adding", () => {
    const limits = {
      verified: false,
      windowHours: 24,
      limitMinor: "5000000",
      used: { receive: "5000000", send: "0" },
    };
    expect(nairaAllowanceLeft(limits, "receive")).toBe(0n);
    expect(nairaAllowanceLeft(limits, "send")).toBe(5_000_000n);
  });

  it("reads typed refusals and only trusts messages that came with a code", () => {
    const refused = {
      data: { code: "VERIFICATION_REQUIRED", message: "Verify" },
    };
    expect(fiatErrorCode(refused)).toBe("VERIFICATION_REQUIRED");
    expect(fiatErrorMessage(refused)).toBe("Verify");
    expect(fiatErrorCode(new Error("socket hang up"))).toBeNull();
    expect(fiatErrorMessage(new Error("socket hang up"))).toBeNull();
  });

  it("parses a payout order's deposit instructions", () => {
    const money = (currency: "NGN" | "USDC", amountMinor: string) => ({
      currency,
      amountMinor,
      decimals: currency === "NGN" ? 2 : 6,
    });
    const route = {
      id: "paycrest:usdc-ngn",
      provider: "paycrest",
      direction: "send",
      environment: "production",
      sourceCurrency: "USDC",
      destinationCurrency: "NGN",
      network: "solana",
      quoteAvailable: true,
      orderAvailable: true,
      accountKinds: [],
      holdsFiat: false,
      thirdPartyPayments: "supported",
    };
    const order = FiatOrderSchema.parse({
      id: "o1",
      route,
      quote: {
        id: "q1",
        route,
        reference: "r",
        expiresAt: new Date().toISOString(),
        debit: money("USDC", "30000000"),
        credit: money("NGN", "4500000"),
        fees: [],
        fields: [],
        paymentStep: "account_transfer",
        verification: {
          limitMinor: "5000000",
          usedMinor: "0",
          verificationRequired: false,
        },
      },
      status: "awaiting_payment",
      instructions: {
        kind: "crypto_transfer",
        message: "Send",
        depositAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        depositAmount: money("USDC", "30100000"),
        payoutAccountName: "ADA OBI",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      simulation: false,
    });
    expect(order.instructions.depositAmount?.amountMinor).toBe("30100000");
  });
});
