import { Injectable, Logger } from '@nestjs/common';
import { FiatError } from '../../fiat.errors';
import {
  PaycrestClient,
  PaycrestRequestError,
  type PaycrestInstitution,
} from './paycrest.client';

const LIST_TTL_MS = 10 * 60_000;

/**
 * Banks a naira payout can reach, and the holder name behind an account
 * number. Codes are Paycrest's own, so the code a Consumer picks here is the
 * one the payout order carries.
 */
@Injectable()
export class PayoutBanksService {
  private readonly logger = new Logger(PayoutBanksService.name);
  private cached: { at: number; banks: PaycrestInstitution[] } | null = null;

  constructor(private readonly paycrest: PaycrestClient) {}

  async list(): Promise<{ banks: PaycrestInstitution[] }> {
    if (this.cached && Date.now() - this.cached.at < LIST_TTL_MS) {
      return { banks: this.cached.banks };
    }
    try {
      const banks = (await this.paycrest.institutions()).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      this.cached = { at: Date.now(), banks };
      return { banks };
    } catch (error) {
      if (this.cached) return { banks: this.cached.banks };
      throw this.unavailable(error);
    }
  }

  async lookup(
    bankCode: string,
    accountNumber: string,
  ): Promise<{ accountName: string | null }> {
    let result: Awaited<ReturnType<PaycrestClient['verifyAccount']>>;
    try {
      result = await this.paycrest.verifyAccount(bankCode, accountNumber);
    } catch (error) {
      throw this.unavailable(error);
    }
    if (!result.found) {
      throw new FiatError(
        'ACCOUNT_NOT_FOUND',
        'That account number was not found at this bank.',
      );
    }
    return { accountName: result.accountName };
  }

  private unavailable(error: unknown): FiatError {
    if (!(error instanceof PaycrestRequestError) || error.status >= 500) {
      this.logger.warn(
        `paycrest unavailable ${error instanceof Error ? error.message : ''}`,
      );
    }
    return new FiatError(
      'ROUTE_UNAVAILABLE',
      'Bank payouts are unavailable right now. Try again shortly.',
      503,
    );
  }
}
