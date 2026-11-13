import { z } from "zod";

export const SUPPORT_TOPICS = [
  "account_access",
  "payments",
  "earn_swap",
  "other",
] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

/**
 * What each topic is called and what belongs under it. Shared by the page that
 * lists them and the page that sends one, so the two cannot disagree.
 */
export const SUPPORT_TOPIC_COPY: Record<
  SupportTopic,
  { label: string; detail: string }
> = {
  account_access: {
    label: "Account access",
    detail: "Signing in, your passkey, recovery keys or a lost phone.",
  },
  payments: {
    label: "Payments",
    detail: "Sending, receiving or paying a merchant.",
  },
  earn_swap: {
    label: "Earn or Swap",
    detail: "Deposits, withdrawals, rates and swaps.",
  },
  other: {
    label: "Something else",
    detail: "Anything that does not fit above.",
  },
};

export function isSupportTopic(value: unknown): value is SupportTopic {
  return (
    typeof value === "string" &&
    (SUPPORT_TOPICS as readonly string[]).includes(value)
  );
}

export interface SupportRequestInput {
  topic: SupportTopic;
  message: string;
  appVersion?: string;
  platform?: "ios" | "android";
}

export const SupportRequestResponseSchema = z.object({
  id: z.string(),
  /** The email a reply will go to, or null when the Account has none. */
  replyTo: z.string().nullable(),
});
export type SupportRequestResponse = z.infer<
  typeof SupportRequestResponseSchema
>;

export interface FeedbackInput {
  message: string;
  appVersion?: string;
  platform?: "ios" | "android";
}

export const FeedbackResponseSchema = z.object({ id: z.string() });
