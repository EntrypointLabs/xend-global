import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { fiatVerifications } from '../../db/schema';
import {
  PajClient,
  PajRequestError,
  type PajKycSession,
} from '../../settlement/providers/paj/paj.client';
import { FiatError } from '../fiat.errors';

const PROVIDER = 'paj';

export type VerificationStatus =
  | 'unverified'
  | 'code_sent'
  | 'in_review'
  | 'verified'
  | 'declined';

export interface VerificationView {
  status: VerificationStatus;
  /** Present when declined; deliberately general, as the partner gives it. */
  declineCode?: string;
  codeExpiresAt?: string;
}

type Row = typeof fiatVerifications.$inferSelect;

const PUBLIC_STATUS: Record<string, VerificationStatus> = {
  OTP_SENT: 'code_sent',
  IN_REVIEW: 'in_review',
  VERIFIED: 'verified',
  DECLINED: 'declined',
};

/**
 * BVN verification through PAJ: the BVN is checked, a code goes to the phone
 * on the BVN record over WhatsApp, and the code coming back proves the person.
 * The BVN and code pass straight through and are never stored or logged.
 */
@Injectable()
export class FiatVerificationService {
  private readonly logger = new Logger(FiatVerificationService.name);

  constructor(
    private readonly db: DbService,
    private readonly paj: PajClient,
    private readonly config: ConfigService,
  ) {}

  async view(userId: string): Promise<VerificationView> {
    let row = await this.row(userId);
    if (row?.status === 'IN_REVIEW' && row.customerId) {
      row = await this.refresh(row).catch(() => row);
    }
    return toView(row);
  }

  async consent(): Promise<{ version: string; text: string }> {
    return this.call(() => this.paj.kycConsent());
  }

  async start(
    userId: string,
    bvn: string,
    consentVersion: string,
  ): Promise<VerificationView> {
    const existing = await this.row(userId);
    if (existing?.status === 'VERIFIED') return toView(existing);
    const externalUserId = existing?.externalUserId ?? this.pseudonym(userId);
    const session = await this.call(() =>
      this.paj.createKycSession({ externalUserId, bvn, consentVersion }),
    );
    return toView(await this.save(userId, externalUserId, session), session);
  }

  async confirm(userId: string, code: string): Promise<VerificationView> {
    const row = await this.row(userId);
    if (!row?.sessionId || row.status !== 'OTP_SENT') {
      throw new FiatError(
        'VERIFICATION_NOT_STARTED',
        'Enter your BVN first.',
        409,
      );
    }
    const sessionId = row.sessionId;
    let session: PajKycSession;
    try {
      session = await this.paj.verifyKycOtp(sessionId, code);
    } catch (error) {
      if (error instanceof PajRequestError && error.status === 400) {
        throw new FiatError(
          'WRONG_CODE',
          "That code didn't match. Check it and try again.",
        );
      }
      throw this.unavailable(error);
    }
    return toView(
      await this.save(userId, row.externalUserId, session),
      session,
    );
  }

  async resend(userId: string): Promise<VerificationView> {
    const row = await this.row(userId);
    if (!row?.sessionId || row.status !== 'OTP_SENT') {
      throw new FiatError(
        'VERIFICATION_NOT_STARTED',
        'Enter your BVN first.',
        409,
      );
    }
    const sessionId = row.sessionId;
    const session = await this.call(() => this.paj.resendKycOtp(sessionId));
    return toView(
      await this.save(userId, row.externalUserId, session),
      session,
    );
  }

  /** The partner's customer id, only while the Consumer is verified. */
  async verifiedCustomerId(userId: string): Promise<string | null> {
    const row = await this.row(userId);
    return row?.status === 'VERIFIED' ? row.customerId : null;
  }

  /** A decision PAJ reports later, usually the end of a manual review. */
  async applyDecision(input: {
    externalUserId: string;
    customerId?: string;
    status: string;
    tier?: number;
  }): Promise<boolean> {
    if (!PUBLIC_STATUS[input.status]) return false;
    const updated = await this.db.client
      .update(fiatVerifications)
      .set({
        status: input.status,
        ...(input.customerId ? { customerId: input.customerId } : {}),
        tier: input.tier ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(fiatVerifications.provider, PROVIDER),
          eq(fiatVerifications.externalUserId, input.externalUserId),
        ),
      )
      .returning({ userId: fiatVerifications.userId });
    return updated.length > 0;
  }

  private async refresh(row: Row): Promise<Row> {
    const customer = await this.paj.getKycCustomer(row.customerId!);
    const [updated] = await this.db.client
      .update(fiatVerifications)
      .set({
        status: customer.status,
        tier: customer.tier ?? null,
        declineCode: customer.declineCode ?? null,
        updatedAt: new Date(),
      })
      .where(eq(fiatVerifications.userId, row.userId))
      .returning();
    return updated ?? row;
  }

  private async row(userId: string): Promise<Row | null> {
    const [row] = await this.db.client
      .select()
      .from(fiatVerifications)
      .where(eq(fiatVerifications.userId, userId));
    return row ?? null;
  }

  private async save(
    userId: string,
    externalUserId: string,
    session: PajKycSession,
  ): Promise<Row> {
    const values = {
      provider: PROVIDER,
      externalUserId,
      status: session.status,
      sessionId: session.sessionId ?? null,
      customerId: session.customerId ?? null,
      tier: session.tier ?? null,
      declineCode: session.declineCode ?? null,
      updatedAt: new Date(),
    };
    const [row] = await this.db.client
      .insert(fiatVerifications)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: fiatVerifications.userId, set: values })
      .returning();
    return row;
  }

  /** Stable per user, so the partner sees one identity without our user id. */
  private pseudonym(userId: string): string {
    const key =
      this.config.get<string>('FIAT_PSEUDONYM_SECRET') ??
      this.config.get<string>('PAJ_API_KEY') ??
      '';
    return `prydd_${createHmac('sha256', key).update(userId).digest('hex').slice(0, 32)}`;
  }

  private async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw this.unavailable(error);
    }
  }

  private unavailable(error: unknown): FiatError {
    if (error instanceof FiatError) return error;
    if (error instanceof PajRequestError) {
      if (error.status === 429) {
        return new FiatError(
          'VERIFICATION_BUSY',
          'Too many attempts. Try again in a few minutes.',
          429,
        );
      }
      if (error.status === 400) {
        return new FiatError(
          'INVALID_BVN',
          'Check your BVN and try again.',
          422,
        );
      }
      // 403 here means PAJ has not switched KYC on for the business yet.
      this.logger.warn(`paj.kyc unavailable status=${error.status}`);
    }
    return new FiatError(
      'VERIFICATION_UNAVAILABLE',
      "Verification isn't available right now. Try again later.",
      503,
    );
  }
}

function toView(row: Row | null, session?: PajKycSession): VerificationView {
  if (!row) return { status: 'unverified' };
  const status = PUBLIC_STATUS[row.status] ?? 'unverified';
  return {
    status,
    ...(status === 'declined' && row.declineCode
      ? { declineCode: row.declineCode }
      : {}),
    ...(status === 'code_sent' && session?.expiresAt
      ? { codeExpiresAt: session.expiresAt }
      : {}),
  };
}
