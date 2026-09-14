import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { BankingRegistry } from './banking.registry';
import type { BankNotification } from './notification-inbox';
import type { BankTransactionObservation } from './banking-provider.interface';

type Claim = {
  id: string;
  query_claim: string;
  query_attempts: number;
  notification: BankNotification;
};

/** Sandbox queries can echo IDs with unrelated canned data. Identity matching is
 * mandatory but still insufficient to attribute a virtual-account deposit.
 */
export function assessBankNotification(
  notification: BankNotification,
  observed: BankTransactionObservation,
): string {
  const created = Date.parse(observed.createdAt);
  const notified = Date.parse(notification.transactionTime);
  if (
    observed.evidence !== 'authenticated_sandbox' ||
    observed.transactionId !== notification.transactionId ||
    observed.merchantId !== notification.merchantId ||
    observed.type !== notification.transactionType ||
    !Number.isFinite(created) ||
    !Number.isFinite(notified) ||
    Math.floor(created / 1000) !== Math.floor(notified / 1000)
  )
    return 'TRANSACTION_IDENTITY_MISMATCH';
  // Completion needs account attribution, monetary reconciliation and the
  // matching transfer/credit journal. Do not infer them from a SUCCESS string.
  return 'SETTLEMENT_RECONCILIATION_REQUIRED';
}

@Injectable()
export class BankNotificationRequeryService {
  private readonly logger = new Logger(BankNotificationRequeryService.name);
  private running = false;
  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    private readonly banking: BankingRegistry,
  ) {}

  @Interval(5000)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.queryNext();
    } catch {
      this.logger.warn('bank.notification.requery_failed');
    } finally {
      this.running = false;
    }
  }

  async queryNext(): Promise<boolean> {
    const merchantId = this.config.get<string>('NOMBA_SANDBOX_ACCOUNT_ID');
    if (
      this.config.get<string>('NODE_ENV') === 'production' ||
      !merchantId ||
      !this.config.get<string>('NOMBA_SANDBOX_WEBHOOK_SECRET')
    )
      return false;
    const reader = this.banking.transactionReader('nomba');
    if (!reader) return false;
    // Claim atomically across processes, then release DB locks before HTTP.
    // Expired leases are reclaimable after a crash; old responses cannot win.
    const claimId = randomUUID();
    const result = await this.db.client.execute(sql`
      UPDATE fiat_bank_notifications SET query_claim = ${claimId},
        query_attempts = query_attempts + 1,
        next_query_at = now() + interval '2 minutes'
      WHERE id = (
        SELECT id FROM fiat_bank_notifications
        WHERE provider = 'nomba' AND environment = 'sandbox'
          AND merchant_id = ${merchantId} AND status = 'received'
          AND next_query_at <= now()
        ORDER BY next_query_at, received_at
        FOR UPDATE SKIP LOCKED LIMIT 1
      ) RETURNING id, query_claim, query_attempts, notification
    `);
    const claim = result.rows[0] as Claim | undefined;
    if (!claim) return false;
    let observation: BankTransactionObservation;
    try {
      observation = await reader.getTransaction(
        claim.notification.transactionId,
      );
    } catch {
      const exhausted = claim.query_attempts >= 6;
      const delay = Math.min(300, 5 * 2 ** Math.min(claim.query_attempts, 6));
      await this.db.client.execute(sql`
        UPDATE fiat_bank_notifications SET
          query_claim = NULL, queried_at = now(),
          query_error = 'PROVIDER_QUERY_UNAVAILABLE',
          status = ${exhausted ? 'needs_attention' : 'received'},
          next_query_at = now() + ${delay} * interval '1 second'
        WHERE id = ${claim.id} AND query_claim = ${claim.query_claim}
          AND status = 'received'
      `);
      return true;
    }
    const reason = assessBankNotification(claim.notification, observation);
    await this.db.client.execute(sql`
      UPDATE fiat_bank_notifications SET query_claim = NULL,
        queried_at = now(), query_result = ${JSON.stringify(observation)}::jsonb,
        query_error = ${reason}, status = 'needs_attention'
      WHERE id = ${claim.id} AND query_claim = ${claim.query_claim}
        AND status = 'received'
    `);
    return true;
  }
}
