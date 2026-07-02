import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import type { ConfirmedTransferEvent } from '../solana/solana-rpc.interface';
import type { WalletAddress } from '../wallet/wallet-provider.interface';

/**
 * The write side of the activity feed. Called by both the webhook hot
 * path (WebhookController) and the boot-time replay (ReconcilerService).
 *
 * Status guard contract:
 *   - A row that is CONFIRMED or FAILED MUST NEVER regress to PENDING.
 *   - Encoded in SQL via a CASE expression in the ON CONFLICT DO UPDATE
 *     clause; encoded again in the reconciler's per-row WHERE clause.
 *   - This protects against late webhook deliveries that arrive after
 *     the reconciler has already finalized the row (or vice versa).
 *
 * Idempotency: `transfers.signature` is UNIQUE and the single write path
 * is `INSERT ... ON CONFLICT (signature) DO UPDATE`, so duplicate
 * webhook deliveries collapse into a single row.
 */
@Injectable()
export class TailerService {
  private readonly logger = new Logger(TailerService.name);

  constructor(private readonly db: DbService) {}

  /**
   * @param smartAccountId the smart_accounts.id of the OWNED wallet that
   *   this event belongs to (sender or receiver). The caller already
   *   verified the wallet is ours and looked up its id.
   * @returns the resolved direction ('SEND' or 'RECEIVE').
   */
  async upsertConfirmedTransfer(
    evt: ConfirmedTransferEvent,
    smartAccountId: string,
    ownedWallet: WalletAddress,
  ): Promise<'SEND' | 'RECEIVE'> {
    const direction: 'SEND' | 'RECEIVE' =
      evt.fromAddress === ownedWallet ? 'SEND' : 'RECEIVE';

    // The CASE in the DO UPDATE clause is the load-bearing status guard:
    // if the existing row is already CONFIRMED or FAILED, keep that
    // status (do not regress); otherwise take the incoming status.
    // confirmed_at and slot use COALESCE so an existing non-null value
    // wins over an incoming one — this preserves the first confirmation
    // timestamp / slot when a duplicate event arrives.
    await this.db.client.execute(sql`
      INSERT INTO transfers (
        id, smart_account_id, signature, direction, mint, amount_raw,
        from_address, to_address, status, slot, confirmed_at, created_at
      ) VALUES (
        ${this.generateId()},
        ${smartAccountId},
        ${evt.signature},
        ${direction}::transfer_direction,
        ${evt.mint},
        ${evt.amountRaw.toString()},
        ${evt.fromAddress},
        ${evt.toAddress},
        'CONFIRMED'::transfer_status,
        ${evt.slot.toString()}::bigint,
        ${evt.confirmedAt.toISOString()}::timestamp,
        NOW()
      )
      ON CONFLICT (signature) DO UPDATE SET
        status = CASE
          WHEN transfers.status IN ('CONFIRMED', 'FAILED')
            THEN transfers.status
          ELSE EXCLUDED.status
        END,
        confirmed_at = COALESCE(transfers.confirmed_at, EXCLUDED.confirmed_at),
        slot = COALESCE(transfers.slot, EXCLUDED.slot)
    `);

    // Update the per-wallet bookmark. Take MAX so out-of-order events
    // (rare; happens when the webhook delivers a slot newer than the
    // boot replay is processing) don't regress the cursor.
    await this.db.client.execute(sql`
      INSERT INTO tailer_state (wallet_address, last_indexed_slot, updated_at)
      VALUES (${ownedWallet}, ${evt.slot.toString()}::bigint, NOW())
      ON CONFLICT (wallet_address) DO UPDATE SET
        last_indexed_slot = GREATEST(
          tailer_state.last_indexed_slot,
          EXCLUDED.last_indexed_slot
        ),
        updated_at = NOW()
    `);

    return direction;
  }

  private generateId(): string {
    // The DB has a $defaultFn on the id column, but raw sql.execute
    // bypasses Drizzle's value generation, so mint one here. Kept
    // cuid2-shaped so rows are sortable by id and indistinguishable from
    // prepare/submit-written rows. Lazy-require so the dependency stays
    // optional in test contexts that mock the DB.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createId } = require('@paralleldrive/cuid2') as {
      createId: () => string;
    };
    return createId();
  }
}
