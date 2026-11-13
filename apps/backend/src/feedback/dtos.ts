import { z } from 'zod';
import { APP_PLATFORMS } from '../db/schema';

export const CreateFeedbackSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  rating: z.number().int().min(1).max(5).optional(),
  appVersion: z.string().max(40).optional(),
  platform: z.enum(APP_PLATFORMS).optional(),
});
export type CreateFeedback = z.infer<typeof CreateFeedbackSchema>;

export const CreateFeedbackResponseSchema = z.object({ id: z.string() });
export type CreateFeedbackResponse = z.infer<
  typeof CreateFeedbackResponseSchema
>;
