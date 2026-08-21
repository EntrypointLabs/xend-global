import { z } from 'zod';

export const RegisterDeviceSchema = z.object({
  /** The provider's address for this installation. */
  token: z.string().min(1),
  platform: z.enum(['ios', 'android']),
});
export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceSchema>;

export const ForgetDeviceSchema = z.object({
  token: z.string().min(1),
});
export type ForgetDeviceRequest = z.infer<typeof ForgetDeviceSchema>;

export const NotificationPreferenceSchema = z.object({
  enabled: z.boolean(),
});
export type NotificationPreferenceRequest = z.infer<
  typeof NotificationPreferenceSchema
>;

export const NotificationPreferenceResponseSchema = z.object({
  enabled: z.boolean(),
});
export type NotificationPreferenceResponse = z.infer<
  typeof NotificationPreferenceResponseSchema
>;
