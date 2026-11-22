import { z } from 'zod';
import { MERCHANT_CATEGORIES } from '../db/schema';

export const SessionSummarySchema = z.object({
  id: z.string(),
  merchantDisplayName: z.string(),
  /** May 404 when the Merchant has no logo; the app then shows the category icon. */
  merchantLogoUrl: z.string(),
  merchantCategory: z.enum(MERCHANT_CATEGORIES),
  createdAt: z.string(),
  lastUsedAt: z.string(),
  expiresAt: z.string(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const ListSessionsResponseSchema = z.object({
  sessions: z.array(SessionSummarySchema),
});
export type ListSessionsResponse = z.infer<typeof ListSessionsResponseSchema>;

export const RevokeSessionParamsSchema = z.object({ id: z.string().min(1) });
export type RevokeSessionParams = z.infer<typeof RevokeSessionParamsSchema>;
