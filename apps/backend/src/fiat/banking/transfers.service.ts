import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { BankingRegistry } from './banking.registry';
import { PagaProvider } from './paga.provider';
import { NairaTransferBody, NairaTransferQuoteBody } from './transfers.types';
import type {
  NairaTransferInput,
  NairaTransferQuoteInput,
  NairaTransferRecord,
} from './transfers.types';
import type { BankAccount } from './banking-provider.interface';

type AccountRow = { id: string; owner_id: string; account: BankAccount };
type TransferRow = {
  id: string;
  owner_id: string;
  source_account_id: string;
  destination_account_id: string;
  idempotency_key: string | null;
  record: NairaTransferRecord;
};

/** Official sandbox Paga internal transfers. No synthetic credits and no merchant-pool payout. */
@Injectable()
export class NairaTransfersService {
  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    private readonly registry: BankingRegistry,
  ) {}
  private available() {
    return (
      this.config.get<string>('NODE_ENV') !== 'production' &&
      this.config.get<string>('FIAT_NGN_ACCOUNT_PROVIDER') === 'paga' &&
      this.registry.accountProvisioningReady('paga')
    );
  }
  private provider() {
    if (!this.available())
      throw new ServiceUnavailableException(
        'Authenticated Paga sandbox is required for account transfers.',
      );
    const provider = this.registry.get('paga');
    if (!(provider instanceof PagaProvider))
      throw new ServiceUnavailableException(
        'Paga subsidiary transfer capability is unavailable.',
      );
    return provider;
  }
  async list(ownerId: string) {
    // A crashed submission cannot be restarted from an unconfirmed local status.
    await this.db.client.execute(sql`UPDATE fiat_bank_transfers
      SET record = jsonb_set(jsonb_set(record, '{status}', '"needs_attention"'::jsonb), '{updatedAt}', to_jsonb(${new Date().toISOString()}::text))
      WHERE owner_id = ${ownerId} AND record->>'status' = 'submitting'
        AND (record->>'updatedAt')::timestamptz < now() - interval '2 minutes'`);
    const rows = await this.db.client
      .execute(sql`SELECT * FROM fiat_bank_transfers
      WHERE owner_id = ${ownerId} ORDER BY created_at DESC LIMIT 100`);
    return {
      environment: 'sandbox' as const,
      available: this.available(),
      scope: 'xend_paga_accounts' as const,
      transfers: (rows.rows as TransferRow[]).map((row) => row.record),
    };
  }
  async quote(ownerId: string, raw: NairaTransferQuoteInput) {
    const input = NairaTransferQuoteBody.parse(raw);
    const provider = this.provider();
    const sourceResult = await this.db.client
      .execute(sql`SELECT id, owner_id, account FROM fiat_bank_accounts
      WHERE owner_id = ${ownerId} AND provider = 'paga' AND environment = 'sandbox' AND status = 'active'`);
    const source = sourceResult.rows[0] as AccountRow | undefined;
    if (!source)
      throw new ConflictException('Create your Paga naira account first.');
    const destinationResult = await this.db.client
      .execute(sql`SELECT id, owner_id, account FROM fiat_bank_accounts
      WHERE provider = 'paga' AND environment = 'sandbox' AND status = 'active'
        AND account->>'accountNumber' = ${input.destinationAccountNumber} AND owner_id <> ${ownerId}`);
    const destination = destinationResult.rows[0] as AccountRow | undefined;
    if (!destination)
      throw new NotFoundException(
        'Recipient must have another active Xend Paga sandbox account.',
      );
    let verified: Awaited<ReturnType<PagaProvider['retrieveAccount']>>;
    try {
      verified = await provider.retrieveAccount(
        destination.account.accountNumber,
        randomUUID(),
      );
    } catch {
      throw new ServiceUnavailableException(
        'Provider recipient verification is unavailable.',
      );
    }
    if (
      verified.accountNumber !== destination.account.accountNumber ||
      verified.accountReference !== destination.account.reference
    )
      throw new ServiceUnavailableException(
        'Provider recipient account does not match.',
      );
    const now = new Date();
    const record: NairaTransferRecord = {
      id: randomUUID(),
      provider: 'paga',
      environment: 'sandbox',
      currency: 'NGN',
      status: 'quoted',
      sourceAccountNumber: source.account.accountNumber,
      destination: {
        accountNumber: verified.accountNumber,
        accountName: verified.accountName,
      },
      amountMinor: input.amountMinor,
      feeMinor: null,
      narration: input.narration,
      expiresAt: new Date(now.getTime() + 5 * 60000).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      providerReference: null,
    };
    await this.db.client
      .execute(sql`INSERT INTO fiat_bank_transfers (id, owner_id, source_account_id, destination_account_id, record)
      VALUES (${record.id}, ${ownerId}, ${source.id}, ${destination.id}, ${JSON.stringify(record)}::jsonb)`);
    return record;
  }
  async send(ownerId: string, raw: NairaTransferInput) {
    const input = NairaTransferBody.parse(raw);
    const provider = this.provider();
    const claim = await this.db.client.transaction(async (tx) => {
      // All outgoing sends serialize on the user's bank account, even across processes.
      const accountResult =
        await tx.execute(sql`SELECT id, owner_id, account FROM fiat_bank_accounts
        WHERE owner_id = ${ownerId} AND provider = 'paga' AND environment = 'sandbox' AND status = 'active' FOR UPDATE`);
      const source = accountResult.rows[0] as AccountRow | undefined;
      if (!source)
        throw new ConflictException('Active source account required.');
      const replay = await tx.execute(
        sql`SELECT * FROM fiat_bank_transfers WHERE owner_id = ${ownerId} AND idempotency_key = ${input.idempotencyKey}`,
      );
      if (replay.rows[0]) {
        const row = replay.rows[0] as TransferRow;
        if (row.id !== input.quoteId)
          throw new ConflictException(
            'Idempotency key belongs to another transfer.',
          );
        return { submit: false as const, record: row.record };
      }
      const result = await tx.execute(
        sql`SELECT * FROM fiat_bank_transfers WHERE id = ${input.quoteId} AND owner_id = ${ownerId} FOR UPDATE`,
      );
      const row = result.rows[0] as TransferRow | undefined;
      if (!row) throw new NotFoundException('Transfer quote not found.');
      if (
        row.record.status !== 'quoted' ||
        row.source_account_id !== source.id ||
        Date.parse(row.record.expiresAt) <= Date.now()
      )
        throw new ConflictException('Get a fresh transfer quote.');
      const pending =
        await tx.execute(sql`SELECT id FROM fiat_bank_transfers WHERE source_account_id = ${source.id}
        AND record->>'status' IN ('submitting', 'needs_attention') LIMIT 1`);
      if (pending.rows.length)
        throw new ConflictException(
          'An earlier transfer is still awaiting provider confirmation.',
        );
      const recipient =
        await tx.execute(sql`SELECT id FROM fiat_bank_accounts WHERE id = ${row.destination_account_id}
        AND provider = 'paga' AND environment = 'sandbox' AND status = 'active'
        AND account->>'accountNumber' = ${row.record.destination.accountNumber}`);
      if (!recipient.rows.length)
        throw new ConflictException('Recipient account is no longer active.');
      let balance: Awaited<ReturnType<PagaProvider['getBalance']>>;
      try {
        balance = await provider.getBalance(
          source.account.accountNumber,
          randomUUID(),
        );
      } catch {
        throw new ServiceUnavailableException(
          'Provider source balance is unavailable.',
        );
      }
      const age = Date.now() - Date.parse(balance.observedAt);
      if (!Number.isFinite(age) || age < -30000 || age > 60000)
        throw new ServiceUnavailableException('Provider balance is stale.');
      if (BigInt(balance.amountMinor) < BigInt(row.record.amountMinor))
        throw new ConflictException('Insufficient naira balance.');
      const record: NairaTransferRecord = {
        ...row.record,
        status: 'submitting',
        updatedAt: new Date().toISOString(),
      };
      await tx.execute(
        sql`UPDATE fiat_bank_transfers SET idempotency_key = ${input.idempotencyKey}, record = ${JSON.stringify(record)}::jsonb WHERE id = ${row.id}`,
      );
      return { submit: true as const, record };
    });
    if (!claim.submit) return claim.record;
    let record = claim.record;
    try {
      const outcome = await provider.transferSubsidiary({
        reference: record.id,
        sourceAccountIdentifier: record.sourceAccountNumber,
        destinationAccountIdentifier: record.destination.accountNumber,
        amountMinor: record.amountMinor,
        narration: record.narration,
      });
      record = {
        ...record,
        status: 'completed',
        providerReference: outcome.providerReference,
        updatedAt: new Date().toISOString(),
      };
    } catch {
      // No resubmission, guessed settlement, refund or balance credit after uncertain execution.
      record = {
        ...record,
        status: 'needs_attention',
        updatedAt: new Date().toISOString(),
      };
    }
    await this.db.client.execute(
      sql`UPDATE fiat_bank_transfers SET record = ${JSON.stringify(record)}::jsonb WHERE id = ${record.id} AND owner_id = ${ownerId}`,
    );
    return record;
  }
}
