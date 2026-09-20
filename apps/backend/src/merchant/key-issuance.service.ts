import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { devnetExecutionEnabled } from './devnet-execution';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DbService, type DbExecutor } from '../db/db.service';
import { apiKeys, merchants, settlementAccounts } from '../db/schema';
import { MerchantNotFoundError } from '../payment/payment.errors';
import { ApiKeyNotFoundError } from './merchant.errors';
import { generateApiKey } from './api-key.util';
import {
  ExecutionClusterDisabledError,
  KybNotVerifiedError,
  KybSubmissionMismatchError,
  SettlementDestinationMissingError,
} from './merchant.errors';

/** The minimal merchant shape the live-key gate reads. */
export interface LiveKeyMerchant {
  kybStatus: string;
}

/** The minimal settlement-account shape the live-key gate reads. */
export interface LiveKeySettlementAccount {
  providerReference: string | null;
}

/**
 * The single live-key gate. Both the service and the ops script call this
 * exact function, so they cannot drift: a live key requires the Merchant's
 * KYB to be verified AND a provisioned provider settlement endpoint whose
 * provider_reference is present. Checking provider-reference-complete (not a
 * bare row) closes the window where a crash between row upsert and provider
 * confirmation would otherwise let a live key issue against an unprovisioned
 * endpoint. Merchants have no wallet or signer under HANDOFF v3; Phase 4 owns
 * provisioning and this function only reads the row.
 *
 * Refusals: KYB_NOT_VERIFIED (KYB not verified),
 * SETTLEMENT_DESTINATION_MISSING (no provider_reference present).
 */
export function assertLiveKeyEligible(
  merchant: LiveKeyMerchant,
  settlementAccount: LiveKeySettlementAccount | null | undefined,
): void {
  if (merchant.kybStatus !== 'verified') {
    throw new KybNotVerifiedError(
      'live keys require a verified KYB (test keys are ungated)',
    );
  }
  if (!settlementAccount || !settlementAccount.providerReference) {
    throw new SettlementDestinationMissingError(
      'live keys require a provisioned provider settlement endpoint',
    );
  }
}

export interface RevokedKey {
  id: string;
  merchantId: string;
  fingerprint: string;
  mode: 'test' | 'live';
  revokedAt: Date;
  /**
   * Whether this call performed the revocation. False when the key was already
   * revoked, so a retry stays idempotent but callers can avoid logging a second
   * audit entry for a transition that did not happen.
   */
  claimed: boolean;
}

/**
 * The single key-issuance path. The ops script drives it today; the
 * merchants.xend.global portal drives it later. Test keys are instant and
 * ungated (KYB never blocks developer experience, only real money). The raw
 * key crosses this boundary exactly once and is never logged or persisted.
 */
@Injectable()
export class KeyIssuanceService {
  constructor(
    private readonly db: DbService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async issueKey(
    merchantId: string,
    mode: 'test' | 'live' | 'devnet',
    options: { name?: string | null; rotatedFromId?: string | null } = {},
    db: DbExecutor = this.db.client,
  ): Promise<{ id: string; raw: string; fingerprint: string }> {
    const [merchant] = await db
      .select()
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .limit(1);
    if (!merchant) {
      throw new MerchantNotFoundError(`merchant ${merchantId} not found`);
    }

    const configuredCluster =
      this.config?.get<string>('SOLANA_CLUSTER') ?? 'mainnet';
    if (mode === 'live' && configuredCluster === 'devnet') {
      throw new ExecutionClusterDisabledError(
        'live keys cannot be issued on devnet; request a devnet execution key',
      );
    }
    if (mode === 'devnet' && !devnetExecutionEnabled(this.config))
      throw new KybNotVerifiedError('Devnet execution is disabled');
    if (mode === 'live' || mode === 'devnet') {
      const executionCluster = mode === 'devnet' ? 'devnet' : configuredCluster;
      const [account] = await db
        .select()
        .from(settlementAccounts)
        .where(
          and(
            eq(settlementAccounts.merchantId, merchantId),
            eq(settlementAccounts.executionCluster, executionCluster),
          ),
        )
        .limit(1);
      if (mode === 'live') assertLiveKeyEligible(merchant, account);
      else if (!account?.providerReference)
        throw new SettlementDestinationMissingError(
          'A confirmed devnet destination is required',
        );
    }

    const key = generateApiKey(mode === 'devnet' ? 'live' : mode);
    const [inserted] = await db
      .insert(apiKeys)
      .values({
        merchantId,
        keyHash: key.keyHash,
        keyPrefix: key.keyPrefix,
        fingerprint: key.fingerprint,
        mode: key.mode,
        executionCluster:
          mode === 'devnet'
            ? 'devnet'
            : mode === 'live'
              ? configuredCluster
              : null,
        name: normalizeName(options.name),
        rotatedFromId: options.rotatedFromId ?? null,
      })
      .returning({ id: apiKeys.id });

    return { id: inserted.id, raw: key.raw, fingerprint: key.fingerprint };
  }

  /**
   * Replaces a key with a fresh secret. Runs inside the caller's transaction so
   * the whole rotation is atomic: an audit-record or issuance failure rolls the
   * revocation back and the old key keeps working. The old key is claimed with
   * a conditional revoke (WHERE revoked_at IS NULL) that also serialises
   * concurrent rotations: the row lock lets exactly one request claim it, and a
   * second concurrent request re-reads a now-revoked row, matches nothing, and
   * is refused rather than minting a second successor. The successor is issued
   * under the same mode, execution cluster and name, linked to its predecessor,
   * and the eligibility gates run again through issueKey.
   */
  async rotateKey(
    keyId: string,
    merchantId: string,
    db: DbExecutor = this.db.client,
  ): Promise<{ id: string; raw: string; fingerprint: string }> {
    const [claimed] = await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiKeys.id, keyId),
          eq(apiKeys.merchantId, merchantId),
          isNull(apiKeys.revokedAt),
        ),
      )
      .returning();
    if (!claimed) throw new ApiKeyNotFoundError(`api key ${keyId} not found`);
    const requestedMode =
      claimed.executionCluster === 'devnet' ? 'devnet' : claimed.mode;
    return this.issueKey(
      merchantId,
      requestedMode,
      { name: claimed.name, rotatedFromId: claimed.id },
      db,
    );
  }

  /**
   * Retires a key. The guard refuses a revoked key on its next use; a key
   * already revoked keeps its original timestamp so the call is safe to repeat.
   */
  async revokeKey(
    keyId: string,
    db: DbExecutor = this.db.client,
  ): Promise<RevokedKey> {
    const [revoked] = await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt)))
      .returning();
    const row =
      revoked ??
      (
        await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).limit(1)
      )[0];
    if (!row?.revokedAt) {
      throw new ApiKeyNotFoundError(`api key ${keyId} not found`);
    }
    return {
      id: row.id,
      merchantId: row.merchantId,
      fingerprint: row.fingerprint,
      mode: row.mode,
      revokedAt: row.revokedAt,
      // A row came back from the conditional update only when this call flipped
      // it; a retry against an already-revoked key falls through to the select.
      claimed: Boolean(revoked),
    };
  }

  /**
   * The manual stage-2 ops action: stamp kyb_status + kyb_verified_at after
   * registration, beneficial ownership, and sanctions checks are done
   * off-system. Verification is bound to the submitted profile version, so an
   * operator can only stamp the exact details that were reviewed: if the owner
   * edited the profile after submitting (which clears the submission) or never
   * submitted, the update is refused and they must (re)submit.
   */
  async markKybVerified(merchantId: string): Promise<void> {
    const now = new Date();
    const [merchant] = await this.db.client
      .select({
        id: merchants.id,
        kybStatus: merchants.kybStatus,
        profileVersion: merchants.profileVersion,
        kybSubmittedVersion: merchants.kybSubmittedVersion,
      })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .limit(1);
    if (!merchant) {
      throw new MerchantNotFoundError(`merchant ${merchantId} not found`);
    }
    // Only the currently reviewed submission can be approved. Requiring the
    // pending state stops a repeated verify from overwriting a rejection (which
    // leaves the submitted version matching the profile) and re-enabling keys.
    if (
      merchant.kybStatus !== 'pending' ||
      merchant.kybSubmittedVersion === null ||
      merchant.kybSubmittedVersion !== merchant.profileVersion
    ) {
      throw new KybSubmissionMismatchError(
        `merchant ${merchantId} has no pending submission matching its current profile; ask them to submit for verification`,
      );
    }
    await this.db.client
      .update(merchants)
      .set({ kybStatus: 'verified', kybVerifiedAt: now, updatedAt: now })
      .where(
        and(
          eq(merchants.id, merchantId),
          eq(merchants.kybStatus, 'pending'),
          eq(merchants.profileVersion, merchant.profileVersion),
        ),
      );
  }

  /**
   * The manual stage-2 ops action for a failed review: stamp kyb_status
   * 'rejected' and the reviewer's note, which the portal surfaces to the owner
   * so a resubmission can fix the named problem. The counterpart to
   * markKybVerified; only the off-system review reaches either.
   */
  async markKybRejected(merchantId: string, reviewNote: string): Promise<void> {
    const now = new Date();
    const [merchant] = await this.db.client
      .select({
        id: merchants.id,
        kybStatus: merchants.kybStatus,
        profileVersion: merchants.profileVersion,
        kybSubmittedVersion: merchants.kybSubmittedVersion,
      })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .limit(1);
    if (!merchant) {
      throw new MerchantNotFoundError(`merchant ${merchantId} not found`);
    }
    // Only reject an active submission the review actually looked at: a delayed
    // result must not reject a profile the owner has since edited, and a
    // stray reject must not clear a merchant that is already verified (which
    // would start returning 403 for every live key). Both are caught by
    // requiring the pending state and a submitted version that still matches
    // the current profile.
    if (
      merchant.kybStatus !== 'pending' ||
      merchant.kybSubmittedVersion === null ||
      merchant.kybSubmittedVersion !== merchant.profileVersion
    ) {
      throw new KybSubmissionMismatchError(
        `merchant ${merchantId} has no pending submission matching its current profile; nothing to reject`,
      );
    }
    await this.db.client
      .update(merchants)
      .set({
        kybStatus: 'rejected',
        kybReviewNote: reviewNote,
        kybVerifiedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(merchants.id, merchantId),
          eq(merchants.kybStatus, 'pending'),
          eq(merchants.profileVersion, merchant.profileVersion),
        ),
      );
  }

  /**
   * Local test tool only: stamp a submission at the current profile version so
   * the dev dashboard's one-click "mark verified" can then satisfy the
   * version-bound markKybVerified without a real review flow. Never wired into
   * production; the real submission goes through the owner-authenticated portal.
   */
  async markKybSubmittedForTest(merchantId: string): Promise<void> {
    const now = new Date();
    const [updated] = await this.db.client
      .update(merchants)
      .set({
        kybStatus: 'pending',
        kybSubmittedAt: now,
        kybSubmittedVersion: sql`${merchants.profileVersion}`,
        kybReviewNote: null,
        updatedAt: now,
      })
      .where(eq(merchants.id, merchantId))
      .returning({ id: merchants.id });
    if (!updated) {
      throw new MerchantNotFoundError(`merchant ${merchantId} not found`);
    }
  }
}

function normalizeName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  return trimmed ? trimmed.slice(0, 60) : null;
}
