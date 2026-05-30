import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  ApplicantId,
  KycAccessToken,
  KycApplicant,
  KycProvider,
  KycStatus,
} from './kyc-provider.interface';

/**
 * Sumsub KYC provider adapter — STUB.
 *
 * Real implementation lands in Phase 3 against the Sumsub server SDK:
 *   - createApplicant: POST /resources/applicants
 *   - getApplicant: GET /resources/applicants/{id}/status
 *   - issueAccessToken: POST /resources/accessTokens (short-lived,
 *     for the WebSDK or native SDK on the mobile side)
 *   - verifyWebhookSignature: HMAC-SHA256 against SUMSUB_WEBHOOK_SECRET
 *   - parseWebhookEvent: maps Sumsub reviewStatus + reviewResult into our
 *     KycStatus enum
 *
 * Every method throws NotImplementedException with a `(Phase 3)` suffix.
 */
@Injectable()
export class SumsubAdapter implements KycProvider {
  async createApplicant(_input: {
    userId: string;
    email: string;
  }): Promise<KycApplicant> {
    throw new NotImplementedException(
      'SumsubAdapter.createApplicant (Phase 3)',
    );
  }

  async getApplicant(_applicantId: ApplicantId): Promise<KycApplicant> {
    throw new NotImplementedException('SumsubAdapter.getApplicant (Phase 3)');
  }

  async issueAccessToken(
    _applicantId: ApplicantId,
  ): Promise<KycAccessToken> {
    throw new NotImplementedException(
      'SumsubAdapter.issueAccessToken (Phase 3)',
    );
  }

  verifyWebhookSignature(
    _rawBody: Buffer,
    _headers: Record<string, string>,
  ): void {
    throw new NotImplementedException(
      'SumsubAdapter.verifyWebhookSignature (Phase 3)',
    );
  }

  parseWebhookEvent(_rawBody: Buffer): {
    eventId: string;
    applicantId: ApplicantId;
    status: KycStatus;
    reviewResult: string | null;
    decidedAt: Date | null;
  } {
    throw new NotImplementedException(
      'SumsubAdapter.parseWebhookEvent (Phase 3)',
    );
  }
}
