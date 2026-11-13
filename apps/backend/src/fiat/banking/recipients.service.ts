import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ZodError } from 'zod';
import { BankingRegistry } from './banking.registry';
import { NombaError } from './nomba.adapter';
import { PagaError } from './paga.provider';
import { candidateBankCodes } from './nuban';
import type { BankPayoutProvider } from './banking-provider.interface';
import type { BankListing, ResolvedBankRecipient } from './recipients.types';

const BANK_LIST_TTL_MS = 6 * 60 * 60 * 1000;
const RESOLVE_WINDOW_MS = 10 * 60 * 1000;
const RESOLVE_LIMIT = 30;

/** Provider answers that mean "no such account at this bank", as opposed to an outage. */
const ACCOUNT_NOT_FOUND = new Set([
  'NOMBA_REQUEST_REJECTED',
  'NOMBA_RECIPIENT_MISMATCH',
  'NOMBA_MISSING_FIELD',
  'NOMBA_INVALID_RECIPIENT',
  'REJECTED',
  'INVALID_INPUT',
]);

function isAccountNotFound(error: unknown): boolean {
  if (error instanceof ZodError) return true;
  return (
    (error instanceof NombaError || error instanceof PagaError) &&
    ACCOUNT_NOT_FOUND.has(error.code)
  );
}

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

@Injectable()
export class BankRecipientsService {
  private cached: { banks: BankListing[]; expiresAt: number } | null = null;
  private loading: Promise<BankListing[]> | null = null;
  private readonly resolves = new Map<string, number[]>();

  constructor(private readonly registry: BankingRegistry) {}

  private provider(): BankPayoutProvider {
    const provider = this.registry.payoutProvider();
    if (!provider)
      throw new ServiceUnavailableException(
        'Bank transfers are unavailable right now.',
      );
    return provider;
  }

  async banks(): Promise<BankListing[]> {
    if (this.cached && this.cached.expiresAt > Date.now())
      return this.cached.banks;
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async load(): Promise<BankListing[]> {
    const provider = this.provider();
    let listed: { code: string; name: string }[];
    try {
      listed = await provider.banks();
    } catch {
      if (this.cached) return this.cached.banks;
      throw new ServiceUnavailableException(
        'We couldn’t load banks right now. Try again shortly.',
      );
    }
    const byCode = new Map<string, BankListing>();
    for (const bank of listed) {
      const code = bank.code.trim();
      const name = cleanName(bank.name);
      if (code && name && !byCode.has(code)) byCode.set(code, { code, name });
    }
    const banks = [...byCode.values()].sort((a, b) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
    );
    this.cached = { banks, expiresAt: Date.now() + BANK_LIST_TTL_MS };
    return banks;
  }

  async candidates(accountNumber: string): Promise<BankListing[]> {
    const banks = await this.banks();
    const byCode = new Map(banks.map((bank) => [bank.code, bank]));
    return candidateBankCodes(accountNumber).flatMap((code) => {
      const bank = byCode.get(code);
      return bank ? [bank] : [];
    });
  }

  async resolve(
    ownerId: string,
    input: { accountNumber: string; bankCode: string },
  ): Promise<ResolvedBankRecipient> {
    this.throttle(ownerId);
    const bank = (await this.banks()).find(
      (candidate) => candidate.code === input.bankCode,
    );
    if (!bank) throw new NotFoundException('We don’t recognise that bank.');
    try {
      const resolved = await this.provider().resolveRecipient(
        bank.code,
        input.accountNumber,
      );
      const accountName = cleanName(resolved.accountName);
      if (resolved.accountNumber !== input.accountNumber || !accountName)
        throw new NombaError('NOMBA_RECIPIENT_MISMATCH');
      return {
        accountNumber: input.accountNumber,
        bankCode: bank.code,
        bankName: bank.name,
        accountName,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (isAccountNotFound(error))
        throw new UnprocessableEntityException(
          'We couldn’t find that account at this bank.',
        );
      throw new ServiceUnavailableException(
        'We couldn’t reach the bank. Try again shortly.',
      );
    }
  }

  private throttle(ownerId: string): void {
    const now = Date.now();
    const recent = (this.resolves.get(ownerId) ?? []).filter(
      (at) => now - at < RESOLVE_WINDOW_MS,
    );
    if (recent.length >= RESOLVE_LIMIT)
      throw new HttpException(
        'Too many account checks. Try again in a few minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    recent.push(now);
    this.resolves.set(ownerId, recent);
  }
}
