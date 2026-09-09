/** Provider contracts for bank rails, separate from conversion and chain custody. */
export type BankOperationStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'unknown';
export interface BankAccount {
  provider: string;
  reference: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
  currency: 'NGN';
  custody: 'pooled' | 'individual';
}
export interface BankRecipient {
  bankCode: string;
  accountNumber: string;
  accountName: string;
}
export interface BankOperation {
  provider: string;
  reference: string;
  providerReference: string;
  status: BankOperationStatus;
  amountMinor: string;
  currency: 'NGN';
  /** Only an authenticated, matched requery may be reconciled. */
  evidence: 'fixture' | 'submitted' | 'verified';
}
export interface BankAccountProvider {
  readonly name: string;
  createAccount(input: {
    reference: string;
    accountReference: string;
    firstName: string;
    lastName: string;
    email: string;
    bvn?: string;
  }): Promise<BankAccount>;
}
/** Authenticated read by the stable reference assigned before account creation. */
export interface BankAccountReader {
  retrieveAccount(
    accountReference: string,
    requestReference: string,
  ): Promise<BankAccount>;
}
/** A customer-scoped balance observation, not an authorization to spend it. */
export interface BankBalanceReader {
  getBalance(
    accountIdentifier: string,
    reference: string,
  ): Promise<{ amountMinor: string; currency: 'NGN'; observedAt: string }>;
}
/** Read-only indicative valuation. This never authorizes an exchange or payout. */
export interface BankUsdValuationReader {
  quoteNgnUsd(amountMinor: string): Promise<{
    debitNgnMinor: string;
    creditUsdMinor: string;
    observedAt: string;
    expiresAt: string;
    environment: 'sandbox';
    evidence: 'fixture';
  }>;
}
export interface BankPayoutProvider {
  readonly name: string;
  banks(): Promise<{ code: string; name: string }[]>;
  resolveRecipient(
    bankCode: string,
    accountNumber: string,
  ): Promise<BankRecipient>;
  submitPayout(input: {
    reference: string;
    amountMinor: string;
    recipient: BankRecipient;
    narration: string;
  }): Promise<BankOperation>;
  getPayout(input: {
    reference: string;
    providerReference: string;
    amountMinor: string;
    recipient: BankRecipient;
  }): Promise<BankOperation>;
}
