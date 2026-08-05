import { z } from 'zod';

export const RegisterEndpointBodySchema = z.object({
  merchant_id: z.string().min(1),
  url: z.string().url(),
  event_types: z.array(z.string()).optional(),
  mode: z.enum(['test', 'live']).default('test'),
});
export type RegisterEndpointBody = z.infer<typeof RegisterEndpointBodySchema>;

export const RedeliverParamsSchema = z.object({
  id: z.string().min(1),
});
export type RedeliverParams = z.infer<typeof RedeliverParamsSchema>;
