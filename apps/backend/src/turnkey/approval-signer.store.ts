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
  /**
   * Every device this Consumer has enrolled.
   *
   * Presence proofs are checked against all of them rather than one the client
   * names: which phone is in their hand is not a claim the client should get to
   * make, and a Consumer with the app on two devices must not be refused on the
   * one they are holding.
   */
  listByUser(userId: string): Promise<ApprovalSignerRow[]>;
  /**
   * The hardware key backing a given sub-organization.
   *
   * Read by the app to answer "is the key on this phone the one this Account
   * enrolled": a device whose key is absent, or whose key belongs to another
   * account on the same phone, cannot approve anything and needs the Device
   * Key moved onto it.
   */
  findBySubOrganization(
    subOrganizationId: string,
  ): Promise<ApprovalSignerRow | null>;
}

@Injectable()
export class DrizzleApprovalSignerStore implements ApprovalSignerStore {
  constructor(private readonly db: DbService) {}

  async findBySubOrganization(
    subOrganizationId: string,
  ): Promise<ApprovalSignerRow | null> {
    const [row] = await this.db.client
      .select()
      .from(approvalSigners)
      .where(eq(approvalSigners.subOrganizationId, subOrganizationId))
      .limit(1);
    return row ?? null;
  }

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

  async listByUser(userId: string): Promise<ApprovalSignerRow[]> {
    return this.db.client
      .select()
      .from(approvalSigners)
      .where(eq(approvalSigners.userId, userId));
  }

  async insert(row: NewApprovalSigner): Promise<ApprovalSignerRow> {
    const [inserted] = await this.db.client
      .insert(approvalSigners)
      .values(row)
      .returning();
    return inserted;
  }
}
