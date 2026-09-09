import { BankAccountInputSchema, BankAccountsSchema } from "../bank-accounts";
describe("provider bank account contract", () => {
  it("keeps unavailable provider access distinct from an account", () => {
    expect(
      BankAccountsSchema.parse({
        provider: "nomba",
        environment: "sandbox",
        available: false,
        accounts: [],
      }).available
    ).toBe(false);
  });
  it("rejects account details marked as live and malformed bank numbers", () => {
    const record = {
      id: "x",
      provider: "paga",
      environment: "sandbox",
      currency: "NGN",
      status: "active",
      createdAt: "now",
      updatedAt: "now",
      account: {
        provider: "paga",
        reference: "ref",
        accountNumber: "0123456789",
        accountName: "Test Person",
        bankName: "Paga",
        currency: "NGN",
        custody: "pooled",
      },
    };
    const envelope = {
      provider: "paga",
      environment: "sandbox",
      available: true,
      accounts: [record],
    };
    expect(BankAccountsSchema.safeParse(envelope).success).toBe(true);
    expect(
      BankAccountsSchema.safeParse({ ...envelope, environment: "live" }).success
    ).toBe(false);
    expect(
      BankAccountsSchema.safeParse({
        ...envelope,
        accounts: [
          { ...record, account: { ...record.account, accountNumber: "123" } },
        ],
      }).success
    ).toBe(false);
  });
  it("does not allow caller-selected owner or invalid BVN", () => {
    const input = {
      firstName: "Test",
      lastName: "Person",
      email: "test@example.com",
    };
    expect(BankAccountInputSchema.safeParse(input).success).toBe(true);
    expect(
      BankAccountInputSchema.safeParse({ ...input, ownerId: "someone-else" })
        .success
    ).toBe(false);
    expect(
      BankAccountInputSchema.safeParse({ ...input, bvn: "123" }).success
    ).toBe(false);
  });
});
