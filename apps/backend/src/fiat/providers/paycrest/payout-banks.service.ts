import { Injectable, Logger } from '@nestjs/common';
import { FiatError } from '../../fiat.errors';
import {
  PaycrestClient,
  PaycrestRequestError,
  type PaycrestInstitution,
} from './paycrest.client';
import { candidateBankCodes } from '../../banking/nuban';
import { bankLogoKey, PAYCREST_BY_NUBAN_CODE } from './bank-logos';

export type PayoutBank = PaycrestInstitution & { logoKey: string | null };

const LIST_TTL_MS = 10 * 60_000;

/**
 * Banks a naira payout can reach, and the holder name behind an account
 * number. Codes are Paycrest's own, so the code a Consumer picks here is the
 * one the payout order carries.
 */
@Injectable()
export class PayoutBanksService {
  private readonly logger = new Logger(PayoutBanksService.name);
  private cached: { at: number; banks: PayoutBank[] } | null = null;

  constructor(private readonly paycrest: PaycrestClient) {}

  async list(): Promise<{ banks: PayoutBank[] }> {
    if (this.cached && Date.now() - this.cached.at < LIST_TTL_MS) {
      return { banks: this.cached.banks };
    }
    try {
      const banks = (await this.paycrest.institutions())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((bank) => ({ ...bank, logoKey: bankLogoKey(bank.code) }));
      this.cached = { at: Date.now(), banks };
      return { banks };
    } catch (error) {
      if (this.cached) return { banks: this.cached.banks };
      throw this.unavailable(error);
    }
  }

  /**
   * Banks this account number could belong to, most used first, from the
   * NUBAN check digit. A guess to save a search, never a check: the lookup
   * still decides.
   */
  async candidates(accountNumber: string): Promise<{ banks: PayoutBank[] }> {
    const { banks } = await this.list();
    const byCode = new Map(banks.map((bank) => [bank.code, bank]));
    return {
      banks: candidateBankCodes(accountNumber)
        .map((code) => byCode.get(PAYCREST_BY_NUBAN_CODE[code] ?? ''))
        .filter((bank): bank is PayoutBank => bank !== undefined),
    };
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
