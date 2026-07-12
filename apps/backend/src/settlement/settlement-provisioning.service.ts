import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { settlementAccounts } from '../db/schema';
import { SOLANA_RPC, type SolanaRpc } from '../solana/solana-rpc.interface';
import { SettlementRouter } from './settlement-router';
import type { SettlementProviderName } from './settlement-provider.interface';
import { SettlementAccountNotProvisionedError } from './settlement.errors';

/**
 * Provisions per-Merchant settlement endpoints THROUGH the provider layer
 * (never the relayer, whose co-sign allowlist deliberately excludes the
 * System program) and records them on the settlement_accounts read-model
 * row as a polymorphic reference. The endpoint token account is registered
 * on the Helius webhook so the tailer/reconciler observe inbound settlement.
 * Pre-provisioning at onboarding avoids a first-payment account-missing
 * failure; provisioning is never inline on the payment hot path.
 */
@Injectable()
export class SettlementProvisioningService {
  private readonly logger = new Logger(SettlementProvisioningService.name);

  constructor(
    private readonly db: DbService,
    @Inject(SOLANA_RPC) private readonly solana: SolanaRpc,
    private readonly router: SettlementRouter,
  ) {}

  async provisionOrLink(
    merchantId: string,
    opts: { currency: string; merchantAddress?: string },
  ): Promise<{
    address: string;
    provider: SettlementProviderName;
    provisioned: boolean;
  }> {
    const [existing] = await this.db.client
      .select()
      .from(settlementAccounts)
      .where(eq(settlementAccounts.merchantId, merchantId))
      .limit(1);
    if (existing?.address && existing.provisionedAt && existing.provider) {
      // Idempotent: an already-provisioned endpoint is returned as-is.
      return {
        address: existing.address,
        provider: existing.provider,
        provisioned: false,
      };
    }

    const provider = this.router.forCurrency(opts.currency);
    const endpoint = await provider.provision({
      merchantId,
      merchantAddress: opts.merchantAddress,
    });
    const providerName = provider.capabilities.provider;

    const row = {
      merchantId,
      address: endpoint.address,
      provider: providerName,
      currency: opts.currency,
      providerReference: endpoint.providerReference,
      payoutConfig: endpoint.payoutConfig,
      authorityAddress: endpoint.attributionRef,
      provisionedAt: new Date(),
      updatedAt: new Date(),
    };
    await this.db.client
      .insert(settlementAccounts)
      .values(row)
      .onConflictDoUpdate({
        target: settlementAccounts.merchantId,
        set: {
          address: row.address,
          provider: row.provider,
          currency: row.currency,
          providerReference: row.providerReference,
          payoutConfig: row.payoutConfig,
          authorityAddress: row.authorityAddress,
          provisionedAt: row.provisionedAt,
          updatedAt: row.updatedAt,
        },
      });

    // Best-effort: the reconciler is the safety net if webhook registration
    // fails, so a failure here must not fail provisioning.
    try {
      await this.solana.registerWebhookAddress(endpoint.address);
    } catch (err) {
      this.logger.warn(
        `settlement.provision webhook registration failed address=${endpoint.address}`,
        err,
      );
    }

    this.logger.log(
      `settlement.provision merchant_id=${merchantId} provider=${providerName} currency=${opts.currency} address=${endpoint.address} attribution_ref=${endpoint.attributionRef ?? 'null'}`,
    );
    return {
      address: endpoint.address,
      provider: providerName,
      provisioned: true,
    };
  }

  async getSettlementAddressForSettlement(
    merchantId: string,
  ): Promise<{ address: string; provider: SettlementProviderName }> {
    const [row] = await this.db.client
      .select()
      .from(settlementAccounts)
      .where(eq(settlementAccounts.merchantId, merchantId))
      .limit(1);
    if (!row?.address || !row.provisionedAt || !row.provider) {
      throw new SettlementAccountNotProvisionedError(
        `merchant ${merchantId} has no provisioned settlement endpoint`,
      );
    }
    return { address: row.address, provider: row.provider };
  }

  // Refund orchestration (resolving an endpoint for a payment's reverse) is
  // a Phase 6/8 concern and is intentionally not built here.
}
