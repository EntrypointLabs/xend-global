import { NairaTransferSchema } from "../naira-transfers";
const transfer = {
  id: "80e7579b-d104-4b02-a26b-4659e5b73882",
  environment: "sandbox",
  provider: "paga",
  currency: "NGN",
  status: "quoted",
  sourceAccountNumber: "0123456789",
  destination: {
    accountNumber: "0987654321",
    accountName: "Sandbox recipient",
  },
  amountMinor: "10000",
  feeMinor: null,
  narration: "Xend transfer",
  expiresAt: "2026-09-09T21:00:00.000Z",
  createdAt: "now",
  updatedAt: "now",
  providerReference: null,
};
describe("naira sandbox transfer contract", () => {
  it("keeps unknown fees and nonterminal states explicit", () => {
    expect(NairaTransferSchema.parse(transfer).feeMinor).toBeNull();
    expect(
      NairaTransferSchema.parse({ ...transfer, status: "needs_attention" })
        .status
    ).toBe("needs_attention");
  });
  it("rejects live results, fractional minor amounts and invalid recipients", () => {
    for (const value of [
      { ...transfer, environment: "live" },
      { ...transfer, amountMinor: "1.5" },
      {
        ...transfer,
        destination: { ...transfer.destination, accountNumber: "123" },
      },
    ])
      expect(NairaTransferSchema.safeParse(value).success).toBe(false);
  });
});
