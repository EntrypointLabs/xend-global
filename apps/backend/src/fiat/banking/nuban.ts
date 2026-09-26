const WEIGHTS = [3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3];

/**
 * The 6-digit institution identifier the CBN NUBAN check digit is computed
 * over. Supported bank code formats:
 * - 3 digits: deposit money bank CBN code, padded as "000" + code.
 * - 5 digits: other financial institution CBN code, prefixed as "9" + code.
 * - 6 digits: NIBSS NIP institution code, used as is. Providers list MFBs and
 *   fintechs by NIP code, not by their 5-digit CBN code, and the published
 *   standard does not map one to the other. Treating the NIP code as the
 *   identifier matched the one real account we checked (Nombank 090645), but
 *   is a heuristic: it only ever narrows suggestions, never gates a payout.
 */
export function nubanIdentifier(bankCode: string): string | null {
  if (/^\d{3}$/.test(bankCode)) return `000${bankCode}`;
  if (/^\d{5}$/.test(bankCode)) return `9${bankCode}`;
  if (/^\d{6}$/.test(bankCode)) return bankCode;
  return null;
}

export function nubanCheckDigit(identifier: string, serial: string): number {
  const digits = `${identifier}${serial}`;
  const sum = [...digits].reduce(
    (total, digit, index) => total + Number(digit) * WEIGHTS[index],
    0,
  );
  return (10 - (sum % 10)) % 10;
}

export function isNubanValid(bankCode: string, accountNumber: string): boolean {
  const identifier = nubanIdentifier(bankCode);
  if (!identifier || !/^\d{10}$/.test(accountNumber)) return false;
  return (
    nubanCheckDigit(identifier, accountNumber.slice(0, 9)) ===
    Number(accountNumber[9])
  );
}

/**
 * The most used Nigerian banks and wallets, by provider bank code, most used
 * first. Roughly one bank in ten passes any given check digit by chance, so
 * suggestions are limited to these rather than every passing institution.
 */
export const POPULAR_BANK_CODES = [
  '305', // Opay
  '090405', // Moniepoint
  '100033', // Palmpay
  '058', // GTBank
  '044', // Access
  '057', // Zenith
  '033', // UBA
  '011', // First Bank
  '090267', // Kuda
  '035', // Wema
  '070', // Fidelity
  '214', // FCMB
  '232', // Sterling
  '032', // Union
  '039', // Stanbic IBTC
  '050', // Ecobank
  '076', // Polaris
  '090645', // Nombank
] as const;

/** Wallets that issue the holder's phone number as the account number. */
const PHONE_NUMBER_WALLETS = new Set(['305', '090405', '100033']);

function looksLikePhoneNumber(accountNumber: string): boolean {
  return /^(70|71|80|81|90|91)\d{8}$/.test(accountNumber);
}

export function candidateBankCodes(accountNumber: string): string[] {
  if (!/^\d{10}$/.test(accountNumber)) return [];
  const phone = looksLikePhoneNumber(accountNumber);
  return POPULAR_BANK_CODES.filter(
    (code) =>
      isNubanValid(code, accountNumber) ||
      (phone && PHONE_NUMBER_WALLETS.has(code)),
  );
}
