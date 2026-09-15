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

/** POST /v1/webhook_endpoints body. The mode comes from the key, never the body. */
export const CreateMerchantEndpointBodySchema = z.object({
  url: z.string().url(),
  event_types: z.array(z.string()).optional(),
});
export type CreateMerchantEndpointBody = z.infer<
  typeof CreateMerchantEndpointBodySchema
>;

/** The merchant-facing endpoint object. `secret` appears only on create and rotate. */
export interface WebhookEndpointObject {
  id: string;
  object: 'webhook_endpoint';
  url: string;
  event_types: string[] | null;
  livemode: boolean;
  created: number;
  secret?: string;
  previous_secret_expires_at?: string;
}
