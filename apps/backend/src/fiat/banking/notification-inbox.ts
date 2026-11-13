import { ConflictException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { DbService } from '../../db/db.service';

/** Provider-authenticated identity fields only. Monetary fields require requery. */
export interface BankNotification {
  eventType: string;
  requestId: string;
  merchantId: string;
  walletId: string;
  transactionId: string;
  transactionType: string;
  transactionTime: string;
  responseCode: string;
}

@Injectable()
export class BankNotificationInbox {
  constructor(private readonly db: DbService) {}

  async receive(
    provider: string,
    environment: 'sandbox' | 'production',
    notification: BankNotification,
  ) {
    const encoded = JSON.stringify(notification);
    const hash = createHash('sha256').update(encoded).digest('hex');
    const inserted = await this.db.client.execute(sql`
      INSERT INTO fiat_bank_notifications
        (id, provider, environment, merchant_id, event_id, transaction_id, signed_hash, notification)
      VALUES (${randomUUID()}, ${provider}, ${environment}, ${notification.merchantId},
        ${notification.requestId}, ${notification.transactionId}, ${hash}, ${encoded}::jsonb)
      ON CONFLICT (provider, environment, merchant_id, event_id) DO NOTHING
      RETURNING id
    `);
    if (inserted.rows.length)
      return { accepted: true as const, duplicate: false };
    const existing = await this.db.client.execute(sql`
      SELECT signed_hash FROM fiat_bank_notifications
      WHERE provider = ${provider} AND environment = ${environment}
        AND merchant_id = ${notification.merchantId} AND event_id = ${notification.requestId}
    `);
    if (existing.rows[0]?.signed_hash !== hash)
      throw new ConflictException('Provider event identity changed.');
    return { accepted: true as const, duplicate: true };
  }
}
