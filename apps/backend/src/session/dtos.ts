import { z } from 'zod';

export const SessionSummarySchema = z.object({
  id: z.string(),
  merchantDisplayName: z.string(),
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
