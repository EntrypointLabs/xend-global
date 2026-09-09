import { ConfigService } from '@nestjs/config';
import { BankingRegistry } from './banking.registry';
describe('banking adapter selection', () => {
  it('does not advertise a conversion just because a bank provider exists', () => {
    const registry = new BankingRegistry(
      new ConfigService({ NODE_ENV: 'test', FIAT_BANKING_PROVIDERS: 'nomba' }),
    );
    expect(registry.get('nomba').name).toBe('nomba');
    expect(registry.capabilities()).toEqual([
      {
        provider: 'nomba',
        environment: 'sandbox',
        authentication: 'anonymous',
        collection: true,
        bankPayout: true,
        conversion: false,
        productionExecution: false,
      },
    ]);
  });
  it('does not provision consumer accounts through anonymous Nomba fixtures', () => {
    const registry = new BankingRegistry(
      new ConfigService({ NODE_ENV: 'test', FIAT_BANKING_PROVIDERS: 'nomba' }),
    );
    expect(registry.accountProvisioningReady('nomba')).toBe(false);
    expect(registry.usdValuationReader()).toBeNull();
    expect(registry.balanceReader('nomba')).toBeNull();
  });
  it('requires a complete Nomba credential set without silently falling back to anonymous mode', () => {
    const registry = new BankingRegistry(
      new ConfigService({
        NODE_ENV: 'test',
        FIAT_BANKING_PROVIDERS: 'nomba',
        NOMBA_SANDBOX_CLIENT_ID: 'fixture-client',
      }),
    );
    expect(registry.capabilities()).toEqual([]);
    expect(registry.accountProvisioningReady('nomba')).toBe(false);
    expect(registry.usdValuationReader()).toBeNull();
    expect(registry.balanceReader('nomba')).toBeNull();
  });
  it('configures authenticated sandbox providers lazily and never advertises real settlement', () => {
    const registry = new BankingRegistry(
      new ConfigService({
        NODE_ENV: 'test',
        FIAT_BANKING_PROVIDERS: 'nomba,paga',
        NOMBA_SANDBOX_CLIENT_ID: 'fixture-client',
        NOMBA_SANDBOX_CLIENT_SECRET: 'fixture-secret',
        NOMBA_SANDBOX_ACCOUNT_ID: 'fixture-account',
        PAGA_SANDBOX_PUBLIC_KEY: 'fixture-public',
        PAGA_SANDBOX_SECRET_KEY: 'fixture-secret',
        PAGA_SANDBOX_HASH_KEY: 'fixture-hash',
      }),
    );
    expect(registry.accountProvisioningReady('nomba')).toBe(true);
    expect(registry.accountProvisioningReady('paga')).toBe(true);
    expect(registry.balanceReader('paga')).toBe(registry.get('paga'));
    expect(registry.usdValuationReader()).toBe(registry.get('nomba'));
    expect(registry.balanceReader('nomba')).toBeNull();
    expect(registry.capabilities()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'nomba',
          authentication: 'authenticated',
          productionExecution: false,
          conversion: false,
        }),
        expect.objectContaining({
          provider: 'paga',
          authentication: 'authenticated',
          productionExecution: false,
        }),
      ]),
    );
  });
  it('requires complete Paga test credentials', () => {
    const registry = new BankingRegistry(
      new ConfigService({
        NODE_ENV: 'test',
        FIAT_BANKING_PROVIDERS: 'paga',
        PAGA_SANDBOX_PUBLIC_KEY: 'fixture',
      }),
    );
    expect(registry.capabilities()).toEqual([]);
    expect(() => registry.get('paga')).toThrow('BANK_PROVIDER_UNAVAILABLE');
  });
  it('cannot enable production execution with configuration', () => {
    const registry = new BankingRegistry(
      new ConfigService({
        NODE_ENV: 'production',
        FIAT_BANKING_PROVIDERS: 'nomba,paga',
      }),
    );
    expect(registry.capabilities()).toEqual([]);
  });
});
