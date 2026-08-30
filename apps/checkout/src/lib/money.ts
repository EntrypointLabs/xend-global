const NAIRA_SIGN = '₦';

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format a naira amount given in minor units (kobo) as a string. Integer-only
 * math via BigInt so values beyond the safe-integer ceiling stay exact. Kobo is
 * shown only when non-zero. No float coercion of the amount is ever performed.
 */
export function formatNairaFromMinor(minorRaw: string): string {
  const minor = BigInt(minorRaw);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;

  const naira = abs / 100n;
  const kobo = abs % 100n;

  const grouped = groupThousands(naira.toString());
  const koboPart = kobo > 0n ? '.' + kobo.toString().padStart(2, '0') : '';

  return `${negative ? '-' : ''}${NAIRA_SIGN}${grouped}${koboPart}`;
}
