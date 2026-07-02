/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars -- unimplemented stub: every method throws and keeps its interface params until the real adapter lands */
import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  ApplicantId,
  KycAccessToken,
  KycApplicant,
  KycProvider,
  KycStatus,
} from './kyc-provider.interface';

/**
 * Sumsub KYC provider adapter — STUB. Every method throws
 * NotImplementedException. The real implementation maps onto the Sumsub
 * server SDK:
 *   - createApplicant: POST /resources/applicants
 *   - getApplicant: GET /resources/applicants/{id}/status
 *   - issueAccessToken: POST /resources/accessTokens (short-lived, for
 *     the WebSDK or native SDK on the mobile side)
 *   - verifyWebhookSignature: HMAC-SHA256 against SUMSUB_WEBHOOK_SECRET
 *   - parseWebhookEvent: maps Sumsub reviewStatus + reviewResult into our
 *     KycStatus enum
 */
@Injectable()
export class SumsubAdapter implements KycProvider {
  async createApplicant(_input: {
    userId: string;
    email: string;
  }): Promise<KycApplicant> {
    throw new NotImplementedException(
      'SumsubAdapter.createApplicant is not implemented',
    );
  }

  async getApplicant(_applicantId: ApplicantId): Promise<KycApplicant> {
    throw new NotImplementedException(
      'SumsubAdapter.getApplicant is not implemented',
    );
  }

  async issueAccessToken(_applicantId: ApplicantId): Promise<KycAccessToken> {
    throw new NotImplementedException(
      'SumsubAdapter.issueAccessToken is not implemented',
    );
  }

  verifyWebhookSignature(
    _rawBody: Buffer,
    _headers: Record<string, string>,
  ): void {
    throw new NotImplementedException(
      'SumsubAdapter.verifyWebhookSignature is not implemented',
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
      'SumsubAdapter.parseWebhookEvent is not implemented',
    );
  }
}
