import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { approvalSigners } from '../db/schema';

export const APPROVAL_SIGNER_STORE = Symbol('APPROVAL_SIGNER_STORE');

export type ApprovalSignerRow = typeof approvalSigners.$inferSelect;
export type NewApprovalSigner = typeof approvalSigners.$inferInsert;

/**
 * Persistence seam for the Turnkey sub-organization backing S2.
 *
 * TurnkeyService owns when a sub-organization may be reused; this owns the
 * storage, so that rule can be tested without a database.
 */
export interface ApprovalSignerStore {
  findByUserAndDevice(
    userId: string,
    hardwarePublicKey: string,
  ): Promise<ApprovalSignerRow | null>;
  insert(row: NewApprovalSigner): Promise<ApprovalSignerRow>;
}

@Injectable()
export class DrizzleApprovalSignerStore implements ApprovalSignerStore {
  constructor(private readonly db: DbService) {}

  async findByUserAndDevice(
    userId: string,
    hardwarePublicKey: string,
  ): Promise<ApprovalSignerRow | null> {
    const [row] = await this.db.client
      .select()
      .from(approvalSigners)
      .where(
        and(
          eq(approvalSigners.userId, userId),
          eq(approvalSigners.hardwarePublicKey, hardwarePublicKey),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async insert(row: NewApprovalSigner): Promise<ApprovalSignerRow> {
    const [inserted] = await this.db.client
      .insert(approvalSigners)
      .values(row)
      .returning();
    return inserted;
  }
}
