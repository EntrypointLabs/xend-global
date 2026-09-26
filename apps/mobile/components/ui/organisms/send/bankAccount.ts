export type SendMode = "crypto" | "bank";

export const ACCOUNT_NUMBER_LENGTH = 10;

export function isAccountNumber(value: string): boolean {
  return /^\d{10}$/.test(value);
}

export function groupAccountNumber(value: string | undefined): string {
  if (!value || !isAccountNumber(value)) return value ?? "";
  return `${value.slice(0, 3)} ${value.slice(3, 6)} ${value.slice(6)}`;
}

/**
 * Pulls an account number out of whatever was copied: a bare number, one
 * written with spaces or dashes, or one inside a message alongside a bank name.
 */
export function extractAccountNumber(text: string): string | null {
  const digits = text.replace(/\D/g, "");
  if (isAccountNumber(digits)) return digits;
  const match = text.match(/(?:^|\D)(\d{10})(?:\D|$)/);
  return match ? match[1] : null;
}

/** A bank account whose holder name the bank itself confirmed. */
export type BankRecipient = {
  accountNumber: string;
  bankCode: string;
  bankName: string;
  accountName: string;
};

/**
 * The payout destination sent to the backend. The bank code travels with the
 * number because a NUBAN is only unique within its bank.
 */
export function encodeBankDestination(recipient: {
  bankCode: string;
  accountNumber: string;
}): string {
  return `${recipient.bankCode}:${recipient.accountNumber}`;
}

export function decodeBankDestination(
  destination: string
): { bankCode: string | null; accountNumber: string } | null {
  const [bankCode, accountNumber] = destination.includes(":")
    ? destination.split(":", 2)
    : [null, destination];
  return accountNumber && isAccountNumber(accountNumber)
    ? { bankCode: bankCode || null, accountNumber }
    : null;
}
