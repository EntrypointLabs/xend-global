import { Inject, Injectable } from '@nestjs/common';
import {
  SETTLEMENT_PROVIDERS,
  SettlementProvider,
  SettlementProviderName,
} from './settlement-provider.interface';
import { SettlementProviderUnavailableError } from './settlement.errors';

/**
 * Selects a SettlementProvider adapter by the Merchant's settlement
 * currency (at provisioning) or by the recorded provider name (at
 * settlement/confirmation/refund, from settlement_accounts.provider).
 *
 * Only the direct-USDC adapter is registered at pilot; an NGN Merchant
 * routes to the not-yet-registered Blockradar slot and gets a typed
 * SettlementProviderUnavailableError until Phase 8 appends that adapter to
 * the SETTLEMENT_PROVIDERS factory array.
 */
@Injectable()
export class SettlementRouter {
  constructor(
    @Inject(SETTLEMENT_PROVIDERS)
    private readonly providers: SettlementProvider[],
  ) {}

  forCurrency(currency: string): SettlementProvider {
    const provider = this.providers.find((p) =>
      p.capabilities.currencies.includes(currency),
    );
    if (!provider) {
      throw new SettlementProviderUnavailableError(
        `no settlement provider registered for currency ${currency}`,
      );
    }
    return provider;
  }

  forProvider(name: SettlementProviderName): SettlementProvider {
    const provider = this.providers.find(
      (p) => p.capabilities.provider === name,
    );
    if (!provider) {
      throw new SettlementProviderUnavailableError(
        `no settlement provider registered with name ${name}`,
      );
    }
    return provider;
  }

  /**
   * Route by a Merchant's settlement currency. Defaults to NGN when the
   * Merchant has no explicit currency, so a naira Merchant correctly
   * fails-unavailable until the Blockradar adapter ships (Phase 8).
   */
  forMerchant(settlementCurrency: string | null): SettlementProvider {
    return this.forCurrency(settlementCurrency ?? 'NGN');
  }
}
