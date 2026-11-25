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

/** @jup-ag/lend 0.4.0 documents supplyRate as APY in 1e4 units. */
export function parseJupiterRate(value: unknown): number {
  const units = z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().finite().min(0).max(100000))
    .parse(String(value));
  return units / 10000;
}
