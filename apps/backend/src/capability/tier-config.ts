import { z } from 'zod';

const RawU64 = z.string().regex(/^\d+$/, 'raw u64 amount string');

export const TierBandSchema = z.object({
  perPaymentMaxRaw: RawU64,
  dailyCapRaw: RawU64,
  monthlyCapRaw: RawU64,
});
export const TierTableSchema = z.record(z.string(), TierBandSchema);
export type TierBand = z.infer<typeof TierBandSchema>;

export function parseTierTable(
  json: string,
  defaultTier: string,
): Record<string, TierBand> {
  const table = TierTableSchema.parse(JSON.parse(json));
  if (!table[defaultTier]) {
    throw new Error(
      `CAPACITY_DEFAULT_TIER '${defaultTier}' missing from CAPACITY_TIERS`,
    );
  }
  return table;
}
