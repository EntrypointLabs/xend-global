import { SettlementRouter } from './settlement-router';
import { SettlementProviderUnavailableError } from './settlement.errors';
import type {
  SettlementProvider,
  SettlementProviderCapabilities,
} from './settlement-provider.interface';

/**
 * Unit tests for SettlementRouter. Uses two fake providers (a direct-USDC
 * fake advertising ['USDC'] and, to prove routing, an NGN fake present in
 * one test and absent in another) to prove currency/name selection and the
 * not-yet-registered-slot behavior.
 */

function fakeProvider(
  capabilities: SettlementProviderCapabilities,
): SettlementProvider {
  return {
    capabilities,
    provision: jest.fn(),
    handleIncomingSettlement: jest.fn(),
    reverse: jest.fn(),
    report: jest.fn(),
  };
}

const directUsdc = fakeProvider({
  provider: 'direct_usdc',
  currencies: ['USDC'],
  refundSupport: true,
  settlementLatency: 'instant',
});

const blockradar = fakeProvider({
  provider: 'blockradar',
  currencies: ['NGN'],
  refundSupport: true,
  settlementLatency: 'deferred',
});

describe('SettlementRouter', () => {
  describe('forCurrency', () => {
    it('returns the USDC adapter for USDC', () => {
      const router = new SettlementRouter([directUsdc]);
      expect(router.forCurrency('USDC')).toBe(directUsdc);
    });

    it('throws SETTLEMENT_PROVIDER_UNAVAILABLE for NGN when no NGN adapter is registered (the Blockradar slot, Phase 8)', () => {
      const router = new SettlementRouter([directUsdc]);
      expect(() => router.forCurrency('NGN')).toThrow(
        SettlementProviderUnavailableError,
      );
    });

    it('routes NGN to the Blockradar adapter once it is registered', () => {
      const router = new SettlementRouter([directUsdc, blockradar]);
      expect(router.forCurrency('NGN')).toBe(blockradar);
    });
  });

  describe('forProvider', () => {
    it('resolves direct_usdc by name', () => {
      const router = new SettlementRouter([directUsdc]);
      expect(router.forProvider('direct_usdc')).toBe(directUsdc);
    });

    it('throws when blockradar is absent', () => {
      const router = new SettlementRouter([directUsdc]);
      expect(() => router.forProvider('blockradar')).toThrow(
        SettlementProviderUnavailableError,
      );
    });
  });

  describe('forMerchant', () => {
    it('defaults a null currency to NGN and fails-unavailable at pilot', () => {
      const router = new SettlementRouter([directUsdc]);
      expect(() => router.forMerchant(null)).toThrow(
        SettlementProviderUnavailableError,
      );
    });

    it('routes a USDC Merchant to the direct-USDC adapter', () => {
      const router = new SettlementRouter([directUsdc]);
      expect(router.forMerchant('USDC')).toBe(directUsdc);
    });
  });
});
