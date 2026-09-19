import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max);
export const MerchantProfileUpdate = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    displayName: z.string().trim().min(2).max(100),
    profile: z
      .object({
        legalName: optionalText(200),
        contactName: optionalText(100),
        contactEmail: z.union([
          z.literal(''),
          z.string().trim().email().max(254),
        ]),
        phone: optionalText(40).refine(
          (v) => !v || /^[+\d\s().-]{5,40}$/.test(v),
          'Enter a valid phone number',
        ),
        website: z.union([
          z.literal(''),
          z
            .string()
            .trim()
            .url()
            .max(2048)
            .refine(
              (v) => new URL(v).protocol === 'https:',
              'Use an HTTPS website',
            ),
        ]),
        addressLine1: optionalText(200),
        addressLine2: optionalText(200),
        city: optionalText(100),
        region: optionalText(100),
        postalCode: optionalText(30),
        country: optionalText(100),
      })
      .strict(),
  })
  .strict();
