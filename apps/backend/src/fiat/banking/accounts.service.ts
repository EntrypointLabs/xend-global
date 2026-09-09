import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { BankingRegistry } from './banking.registry';
import { CreateNairaAccountBody } from './accounts.types';
import type {
  CreateNairaAccountInput,
  NairaAccountRecord,
} from './accounts.types';

type AccountRow = {
  id: string;
  provider: string;
  environment: 'sandbox';
  status: NairaAccountRecord['status'];
  account: NairaAccountRecord['account'];
  created_at: Date;
  updated_at: Date;
};
const view = (row: AccountRow): NairaAccountRecord => ({
  id: row.id,
  provider: row.provider,
  environment: row.environment,
  currency: 'NGN',
  status: row.status,
  account: row.account,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

/** Actual sandbox account provisioning. Never credits money or treats an account as KYC approval. */
@Injectable()
export class NairaAccountsService {
  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    private readonly registry: BankingRegistry,
  ) {}

  private provider() {
    const selected = this.config.get<string>('FIAT_NGN_ACCOUNT_PROVIDER');
    return selected === 'nomba' || selected === 'paga' ? selected : null;
  }

  private available(provider: string | null) {
    return (
      this.config.get<string>('NODE_ENV') !== 'production' &&
      provider !== null &&
      this.registry.accountProvisioningReady(provider)
    );
  }

  async list(ownerId: string) {
    // A process may have died after provider submission. Preserve the claim and
    // flag it for reconciliation; creating a second account is never the retry.
    await this.db.client.execute(sql`
      UPDATE fiat_bank_accounts SET status = 'needs_attention', updated_at = now()
      WHERE owner_id = ${ownerId} AND environment = 'sandbox' AND status = 'creating'
        AND created_at < now() - interval '2 minutes'
    `);
    const result = await this.db.client.execute(sql`
      SELECT * FROM fiat_bank_accounts WHERE owner_id = ${ownerId}
        AND environment = 'sandbox' ORDER BY created_at ASC
    `);
    const provider = this.provider();
    return {
      provider,
      environment: 'sandbox' as const,
      available: this.available(provider),
      accounts: (result.rows as AccountRow[]).map(view),
    };
  }

  async create(ownerId: string, raw: CreateNairaAccountInput) {
    const input = CreateNairaAccountBody.parse(raw);
    const provider = this.provider();
    if (!provider || !this.available(provider))
      throw new ServiceUnavailableException(
        'Credentialed sandbox banking provider is not configured.',
      );
    const id = randomUUID();
    // Paga requires 12–30 characters. Stable values are retained for operator requery.
    const accountReference = `xna${randomBytes(10).toString('hex')}`;
    const claim = await this.db.client.execute(sql`
      INSERT INTO fiat_bank_accounts
        (id, owner_id, provider, environment, status, account_reference)
      VALUES (${id}, ${ownerId}, ${provider}, 'sandbox', 'creating', ${accountReference})
      ON CONFLICT (owner_id, provider, environment) DO NOTHING RETURNING *
    `);
    if (!claim.rows.length) {
      const existing = await this.list(ownerId);
      return existing.accounts.find(
        (account) => account.provider === provider,
      )!;
    }

    try {
      const account = await this.registry.get(provider).createAccount({
        ...input,
        reference: id,
        accountReference,
      });
      if (
        account.provider !== provider ||
        account.reference !== accountReference ||
        account.currency !== 'NGN' ||
        !/^\d{10}$/.test(account.accountNumber) ||
        !account.accountName ||
        !account.bankName
      )
        throw new Error('BANK_ACCOUNT_RESPONSE_MISMATCH');
      const saved = await this.db.client.execute(sql`
        UPDATE fiat_bank_accounts SET status = 'active',
          account = ${JSON.stringify(account)}::jsonb, updated_at = now()
        WHERE id = ${id} AND owner_id = ${ownerId} RETURNING *
      `);
      return view(saved.rows[0] as AccountRow);
    } catch {
      // Do not store provider error payloads: they can contain identity data.
      // Even rejected submissions need deliberate reconciliation before retry.
      const failed = await this.db.client.execute(sql`
        UPDATE fiat_bank_accounts SET status = 'needs_attention', updated_at = now()
        WHERE id = ${id} AND owner_id = ${ownerId} RETURNING *
      `);
      return view(failed.rows[0] as AccountRow);
    }
  }
}
