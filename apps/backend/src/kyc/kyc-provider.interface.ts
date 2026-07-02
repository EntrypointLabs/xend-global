/**
 * Anti-lock-in seam for KYC. Sumsub is the v1 adapter. Business logic in
 * the `kyc` module and the `/webhooks/sumsub` route depends only on this
 * contract; swapping to a different KYC vendor later is a single adapter
 * swap.
 */

/** Opaque provider-side applicant identifier (e.g. Sumsub applicant ID). */
export type ApplicantId = string;

export type KycStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED';

/** DI token for the active KycProvider binding. */
export const KYC_PROVIDER = Symbol('KycProvider');

export interface KycApplicant {
  applicantId: ApplicantId;
  status: KycStatus;
  reviewResult: string | null;
  decidedAt: Date | null;
}

export interface KycAccessToken {
  accessToken: string;
  expiresAt: Date;
}

export interface KycProvider {
  createApplicant(input: {
    userId: string;
    email: string;
  }): Promise<KycApplicant>;

  getApplicant(applicantId: ApplicantId): Promise<KycApplicant>;

  issueAccessToken(applicantId: ApplicantId): Promise<KycAccessToken>;

  /** Verify a webhook signature; throws on mismatch. */
  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): void;

  /** Parse a verified webhook body into a status update. */
  parseWebhookEvent(rawBody: Buffer): {
    eventId: string;
    applicantId: ApplicantId;
    status: KycStatus;
    reviewResult: string | null;
    decidedAt: Date | null;
  };
}
