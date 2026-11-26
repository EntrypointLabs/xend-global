import { z } from 'zod';
import { EARN_PROVIDERS, EARN_USDC } from '@prydd/smart-account';
const rate = z
  .union([z.number(), z.string().regex(/^\d+(\.\d+)?$/)])
  .transform(Number)
  .pipe(z.number().finite().min(0).max(10));
const row = z.object({
  reserve: z.literal(EARN_PROVIDERS.kamino.reserve),
  liquidityTokenMint: z.literal(EARN_USDC.toBase58()),
  supplyApy: rate,
});
export function parseKaminoRate(payload: unknown): number {
  const entries = z
    .array(z.unknown())
    .parse(payload)
    .filter(
      (value) =>
        typeof value === 'object' &&
        value !== null &&
        'reserve' in value &&
        value.reserve === EARN_PROVIDERS.kamino.reserve,
    );
  if (entries.length !== 1) throw new Error('Pinned Kamino rate unavailable');
  return row.parse(entries[0]).supplyApy;
}

/** Jupiter Lend reports supplyRate as APY in 1e4 units. */
export function parseJupiterRate(value: unknown): number {
  const units = z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().finite().min(0).max(100000))
    .parse(String(value));
  return units / 10000;
}

const jupiterToken = z.object({
  address: z.string(),
  supplyRate: z.union([z.string(), z.number()]),
});
/**
 * Jupiter Lend's public token list, keyed by lending token address. One entry
 * that cannot be read is left out rather than failing every other rate.
 */
export function parseJupiterRates(payload: unknown): Map<string, number> {
  const rates = new Map<string, number>();
  for (const entry of z.array(z.unknown()).parse(payload)) {
    const token = jupiterToken.safeParse(entry);
    if (!token.success) continue;
    try {
      rates.set(token.data.address, parseJupiterRate(token.data.supplyRate));
    } catch {
      continue;
    }
  }
  return rates;
}
