import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { apiKeys, merchants, settlementAccounts } from '../db/schema';
import { MerchantNotFoundError } from '../payment/payment.errors';
import { generateApiKey } from './api-key.util';
import {
  KybNotVerifiedError,
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

/**
 * The single key-issuance path. The ops script drives it today; the
 * merchants.xend.global portal drives it later. Test keys are instant and
 * ungated (KYB never blocks developer experience, only real money). The raw
 * key crosses this boundary exactly once and is never logged or persisted.
 */
@Injectable()
export class KeyIssuanceService {
  constructor(private readonly db: DbService) {}

  async issueKey(
    merchantId: string,
    mode: 'test' | 'live',
  ): Promise<{ raw: string; fingerprint: string }> {
    const [merchant] = await this.db.client
      .select()
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .limit(1);
    if (!merchant) {
      throw new MerchantNotFoundError(`merchant ${merchantId} not found`);
    }

    if (mode === 'live') {
      const [account] = await this.db.client
        .select()
        .from(settlementAccounts)
        .where(eq(settlementAccounts.merchantId, merchantId))
        .limit(1);
      assertLiveKeyEligible(merchant, account);
    }

    const key = generateApiKey(mode);
    await this.db.client.insert(apiKeys).values({
      merchantId,
      keyHash: key.keyHash,
      keyPrefix: key.keyPrefix,
      fingerprint: key.fingerprint,
      mode: key.mode,
    });

    return { raw: key.raw, fingerprint: key.fingerprint };
  }

  /**
   * The manual stage-2 ops action: stamp kyb_status + kyb_verified_at after
   * registration, beneficial ownership, and sanctions checks are done
   * off-system.
   */
  async markKybVerified(merchantId: string): Promise<void> {
    const now = new Date();
    const [updated] = await this.db.client
      .update(merchants)
      .set({ kybStatus: 'verified', kybVerifiedAt: now, updatedAt: now })
      .where(eq(merchants.id, merchantId))
      .returning({ id: merchants.id });
    if (!updated) {
      throw new MerchantNotFoundError(`merchant ${merchantId} not found`);
    }
  }
}
