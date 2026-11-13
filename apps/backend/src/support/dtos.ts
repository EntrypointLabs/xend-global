import { z } from 'zod';
import { APP_PLATFORMS, SUPPORT_TOPICS } from '../db/schema';

export const CreateSupportRequestSchema = z.object({
  topic: z.enum(SUPPORT_TOPICS),
  message: z.string().trim().min(1).max(4000),
  appVersion: z.string().max(40).optional(),
  platform: z.enum(APP_PLATFORMS).optional(),
});
export type CreateSupportRequest = z.infer<typeof CreateSupportRequestSchema>;

export const CreateSupportRequestResponseSchema = z.object({
  id: z.string(),
  /**
   * The address on the Account a reply will go to, so the app can say where
   * to look for one. Null when the Account has no address to reply to.
   */
  replyTo: z.string().nullable(),
});
export type CreateSupportRequestResponse = z.infer<
  typeof CreateSupportRequestResponseSchema
>;
