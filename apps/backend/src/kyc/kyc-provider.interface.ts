/**
 * KycProvider — anti-lock-in seam for KYC.
 *
 * Per PROJECT.md core essence and spec §6: Sumsub is the v1 adapter, replacing
 * Grid + Bridge. Business logic in the `kyc` module and the `/webhooks/sumsub`
 * route depends only on this contract; swapping to a different KYC vendor
 * later is a single adapter swap.
 *
 * Spec: docs/specs/migration-already-built-features.md §6.
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
