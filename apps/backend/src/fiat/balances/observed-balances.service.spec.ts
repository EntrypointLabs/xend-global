import { ConfigService } from '@nestjs/config';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { DbService } from '../../db/db.service';
import type {
  SolanaRpc,
  TokenBalance,
} from '../../solana/solana-rpc.interface';
import type { BankingRegistry } from '../banking/banking.registry';
import { ObservedBalancesService } from './observed-balances.service';

const mint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const vault = '11111111111111111111111111111111';
const accountReference = 'xna01234567890123456789';
function setup(configValues: Record<string, string | undefined> = {}) {
  const config = new ConfigService({
    SOLANA_CLUSTER: 'devnet',
    EXPO_PUBLIC_USDC_MINT_ADDRESS: mint,
    HELIUS_RPC_URL: 'https://devnet.helius-rpc.com/?api-key=not-a-key',
    SOLANA_PUBLIC_RPC_URL: 'https://api.devnet.solana.com',
    FIAT_NGN_ACCOUNT_PROVIDER: 'paga',
    ...configValues,
  });
  const state = {
    accountRows: [
      {
        status: 'active',
        account_reference: accountReference,
        account: {
          provider: 'paga',
          currency: 'NGN',
          reference: accountReference,
        },
      },
    ],
    vaultRows: [{ vault_address: vault }],
  };
  const queries: { sql: string; params: unknown[] }[] = [];
  const execute = jest.fn((query: SQL) => {
    const compiled = new PgDialect().sqlToQuery(query);
    queries.push(compiled);
    return Promise.resolve({
      rows: compiled.sql.includes('fiat_bank_accounts')
        ? state.accountRows
        : state.vaultRows,
    });
  });
  const getBalance = jest.fn().mockResolvedValue({
    currency: 'NGN',
    amountMinor: '50000000',
    observedAt: new Date().toISOString(),
  });
  const balanceReader = jest.fn().mockReturnValue({ getBalance });
  const usdValuationReader = jest.fn().mockReturnValue(null);
  const getTokenBalances = jest
    .fn<Promise<TokenBalance[]>, [string]>()
    .mockResolvedValue([{ mint, amountRaw: 100000000n, decimals: 6 }]);
  const service = new ObservedBalancesService(
    { client: { execute } } as unknown as DbService,
    config,
    { balanceReader, usdValuationReader } as unknown as BankingRegistry,
    { getTokenBalances } as unknown as SolanaRpc,
  );
  return {
    service,
    state,
    queries,
    getBalance,
    balanceReader,
    usdValuationReader,
    getTokenBalances,
    config,
  };
}

describe('owned provider and chain balance observations', () => {
  it('reads the owner-bound Paga account and Squads vault and never consults simulation holdings', async () => {
    const test = setup();
    const result = await test.service.get('owner-a');
    expect(result).toMatchObject({
      mode: 'observed',
      bankEnvironment: 'sandbox',
      network: 'devnet',
      total: null,
      valuationReason: 'QUOTE_UNAVAILABLE',
    });
    expect(result.holdings.map((holding) => holding.amountMinor)).toEqual([
      '50000000',
      '100000000',
    ]);
    expect(test.queries).toHaveLength(2);
    expect(test.queries[0].params).toEqual(['owner-a', 'paga']);
    expect(test.queries[0].sql).toContain("environment = 'sandbox'");
    expect(test.queries[1].params).toEqual(['owner-a']);
    expect(
      test.queries.every((query) => query.sql.trim().startsWith('SELECT')),
    ).toBe(true);
    expect(test.getBalance).toHaveBeenCalledWith(
      accountReference,
      expect.any(String),
    );
    expect(test.getTokenBalances).toHaveBeenCalledWith(vault);
  });

  it('preserves integers above JavaScript safe precision and sums same-mint token accounts exactly', async () => {
    const test = setup();
    test.getBalance.mockResolvedValue({
      currency: 'NGN',
      amountMinor: '900719925474099312345',
      observedAt: new Date().toISOString(),
    });
    test.getTokenBalances.mockResolvedValue([
      { mint, amountRaw: 9007199254740993n, decimals: 6 },
      { mint, amountRaw: 9n, decimals: 6 },
      { mint: 'unrelated', amountRaw: 50000000000n, decimals: 9 },
    ]);
    const result = await test.service.get('owner');
    expect(result.holdings.map((holding) => holding.amountMinor)).toEqual([
      '900719925474099312345',
      '9007199254741002',
    ]);
  });

  it('reports verified empty balances as zero', async () => {
    const test = setup();
    test.getBalance.mockResolvedValue({
      currency: 'NGN',
      amountMinor: '0',
      observedAt: new Date().toISOString(),
    });
    test.getTokenBalances.mockResolvedValue([]);
    const result = await test.service.get('owner');
    expect(result.holdings.map((holding) => holding.amountMinor)).toEqual([
      '0',
      '0',
    ]);
    expect(result.total).toMatchObject({
      currency: 'USD',
      amountMinor: '0',
      estimate: true,
    });
  });

  it('does not invent a local demo vault or an absent bank account', async () => {
    const test = setup();
    test.state.accountRows = [];
    test.state.vaultRows = [];
    const result = await test.service.get('local-unified-simulation');
    expect(result.holdings.map((holding) => holding.amountMinor)).toEqual([
      null,
      null,
    ]);
    expect(test.getBalance).not.toHaveBeenCalled();
    expect(test.getTokenBalances).not.toHaveBeenCalled();
    expect(result.total).toBeNull();
  });

  it('does not read a merchant or parent balance for a Nomba virtual account', async () => {
    const test = setup({ FIAT_NGN_ACCOUNT_PROVIDER: 'nomba' });
    test.state.accountRows[0].account.provider = 'nomba';
    test.balanceReader.mockReturnValue(null);
    const result = await test.service.get('owner');
    expect(result.holdings[0]).toMatchObject({
      amountMinor: null,
      reason: 'CUSTOMER_BALANCE_UNAVAILABLE',
    });
    expect(test.getBalance).not.toHaveBeenCalled();
  });

  it('rejects an account whose provider reference differs from its persisted binding', async () => {
    const test = setup();
    test.state.accountRows[0].account.reference = 'someone-else';
    expect((await test.service.get('owner')).holdings[0].reason).toBe(
      'BANK_ACCOUNT_MISMATCH',
    );
    expect(test.getBalance).not.toHaveBeenCalled();
  });

  it('keeps pending accounts unavailable', async () => {
    const test = setup();
    test.state.accountRows[0].status = 'creating';
    expect(
      (await test.service.get('owner')).holdings[0].amountMinor,
    ).toBeNull();
    expect(test.getBalance).not.toHaveBeenCalled();
  });

  it.each([
    { amountMinor: '-1' },
    { amountMinor: '1.5' },
    { amountMinor: 'NaN' },
    { currency: 'USD' },
    { observedAt: 'nonsense' },
    { observedAt: new Date(Date.now() - 180000).toISOString() },
    { observedAt: new Date(Date.now() + 60000).toISOString() },
  ])(
    'keeps invalid or stale bank observations unavailable: %j',
    async (invalid) => {
      const test = setup();
      test.getBalance.mockResolvedValue({
        currency: 'NGN',
        amountMinor: '100',
        observedAt: new Date().toISOString(),
        ...invalid,
      });
      const result = await test.service.get('owner');
      expect(result.holdings[0]).toMatchObject({
        amountMinor: null,
        reason: 'BANK_BALANCE_INVALID_OR_STALE',
      });
      expect(result.total).toBeNull();
    },
  );

  it('keeps provider errors unavailable without leaking provider error text', async () => {
    const test = setup();
    test.getBalance.mockRejectedValue(new Error('private-provider-details'));
    const result = await test.service.get('owner');
    expect(result.holdings[0].amountMinor).toBeNull();
    expect(JSON.stringify(result)).not.toContain('private-provider-details');
    expect(result.holdings[1].amountMinor).toBe('100000000');
  });

  it('keeps RPC failure unavailable while retaining independently observed NGN', async () => {
    const test = setup();
    test.getTokenBalances.mockRejectedValue(new Error('private-rpc-url'));
    const result = await test.service.get('owner');
    expect(result.holdings[1].amountMinor).toBeNull();
    expect(result.holdings[0].amountMinor).toBe('50000000');
    expect(JSON.stringify(result)).not.toContain('private-rpc-url');
  });

  it.each([
    { decimals: 9, amountRaw: 100n },
    { decimals: 6, amountRaw: -1n },
  ])('rejects malformed canonical token observations', async (invalid) => {
    const test = setup();
    test.getTokenBalances.mockResolvedValue([{ mint, ...invalid }]);
    expect((await test.service.get('owner')).holdings[1].reason).toBe(
      'CHAIN_BALANCE_INVALID',
    );
  });

  it.each([
    { EXPO_PUBLIC_USDC_MINT_ADDRESS: 'unrelated' },
    { SOLANA_CLUSTER: 'mainnet' },
    { SOLANA_PUBLIC_RPC_URL: 'https://api.mainnet-beta.solana.com' },
    { HELIUS_RPC_URL: 'https://unknown-rpc.example.com' },
  ])(
    'does not query a mismatched or unverified network: %j',
    async (config) => {
      const test = setup(config);
      const result = await test.service.get('owner');
      expect(result.holdings[1].amountMinor).toBeNull();
      expect(test.getTokenBalances).not.toHaveBeenCalled();
    },
  );

  it('never combines mainnet cash with sandbox bank balances', async () => {
    const mainnetMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const test = setup({
      SOLANA_CLUSTER: 'mainnet',
      EXPO_PUBLIC_USDC_MINT_ADDRESS: mainnetMint,
      HELIUS_RPC_URL: 'https://mainnet.helius-rpc.com',
      SOLANA_PUBLIC_RPC_URL: 'https://api.mainnet-beta.solana.com',
    });
    test.getTokenBalances.mockResolvedValue([
      { mint: mainnetMint, amountRaw: 100000000n, decimals: 6 },
    ]);
    const result = await test.service.get('owner');
    expect(
      result.holdings.every((holding) => holding.status === 'available'),
    ).toBe(true);
    expect(result.total).toBeNull();
    expect(result.valuationReason).toBe('ENVIRONMENTS_DO_NOT_MATCH');
  });
});

describe('observed balance indicative valuation', () => {
  const quoteFixture = () => ({
    debitNgnMinor: '50000000',
    creditUsdMinor: '30000',
    observedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    environment: 'sandbox',
    evidence: 'fixture',
  });
  it('combines a matching sandbox NGN/USD estimate with devnet USDC using exact cents', async () => {
    const test = setup();
    const quoteNgnUsd = jest.fn().mockResolvedValue(quoteFixture());
    test.usdValuationReader.mockReturnValue({ quoteNgnUsd });
    const result = await test.service.get('owner');
    expect(quoteNgnUsd).toHaveBeenCalledWith('50000000');
    expect(result.total).toMatchObject({
      currency: 'USD',
      amountMinor: '40000',
      estimate: true,
    });
    expect(result.valuationReason).toBeNull();
  });

  it.each([
    { debitNgnMinor: '123' },
    { creditUsdMinor: '-1' },
    { creditUsdMinor: 30000 },
    { creditUsdMinor: '0' },
    { environment: 'production' },
    { evidence: 'verified' },
    { expiresAt: new Date(Date.now() - 10000).toISOString() },
    { observedAt: new Date(Date.now() + 60000).toISOString() },
    { observedAt: new Date(Date.now() - 120000).toISOString() },
  ])(
    'rejects mismatched, malformed or stale quote %j without hiding holdings',
    async (override) => {
      const test = setup();
      test.usdValuationReader.mockReturnValue({
        quoteNgnUsd: jest
          .fn()
          .mockResolvedValue({ ...quoteFixture(), ...override }),
      });
      const result = await test.service.get('owner');
      expect(result.total).toBeNull();
      expect(result.valuationReason).toBe('QUOTE_UNAVAILABLE');
      expect(result.holdings.map((holding) => holding.amountMinor)).toEqual([
        '50000000',
        '100000000',
      ]);
    },
  );

  it('preserves observed balances if the rate provider fails', async () => {
    const test = setup();
    test.usdValuationReader.mockReturnValue({
      quoteNgnUsd: jest
        .fn()
        .mockRejectedValue(new Error('private-provider-error')),
    });
    const result = await test.service.get('owner');
    expect(result.total).toBeNull();
    expect(
      result.holdings.every((holding) => holding.status === 'available'),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-provider-error');
  });
});
