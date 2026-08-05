import type { DbService } from '../db/db.service';
import { merchants, settlementAccounts } from '../db/schema';
import { KeyIssuanceService } from './key-issuance.service';

type MerchantRow = typeof merchants.$inferSelect;
type SettlementRow = typeof settlementAccounts.$inferSelect;

function merchantRow(over: Partial<MerchantRow> = {}): MerchantRow {
  return {
    id: 'm1',
    name: 'Acme',
    displayName: 'Acme Store',
    status: 'active',
    intentTtlMinutes: null,
    allowedOrigins: null,
    kybStatus: 'pending',
    kybVerifiedAt: null,
    flatFeeBps: 0,
    fxSpreadBps: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

function settlementRow(over: Partial<SettlementRow> = {}): SettlementRow {
  return {
    id: 'sa1',
    merchantId: 'm1',
    address: 'Addr',
    provider: 'direct_usdc',
    currency: 'USDC',
    providerReference: 'ref-123',
    payoutConfig: null,
    authorityAddress: null,
    provisionedAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

function makeFakeDb(cfg: {
  merchantRows?: MerchantRow[];
  settlementRows?: SettlementRow[];
}) {
  const inserts: { values: unknown }[] = [];
  const updates: unknown[] = [];
  const selectChain = (rows: unknown[]) => ({
    where: () => ({ limit: () => Promise.resolve(rows) }),
  });
  const client = {
    select: () => ({
      from: (tbl: unknown) => {
        if (tbl === merchants) return selectChain(cfg.merchantRows ?? []);
        if (tbl === settlementAccounts)
          return selectChain(cfg.settlementRows ?? []);
        throw new Error('unknown table');
      },
    }),
    insert: () => ({
      values: (v: unknown) => {
        inserts.push({ values: v });
        return Promise.resolve();
      },
    }),
    update: () => {
      const chain = {
        set: (v: unknown) => {
          updates.push(v);
          return chain;
        },
        where: () => chain,
        returning: () => Promise.resolve([{ id: 'm1' }]),
      };
      return chain;
    },
  };
  return { db: { client } as unknown as DbService, inserts, updates };
}

describe('KeyIssuanceService.issueKey', () => {
  it('issues a test key instantly for a pending-KYB merchant with no settlement account', async () => {
    const { db, inserts } = makeFakeDb({ merchantRows: [merchantRow()] });
    const service = new KeyIssuanceService(db);
    const result = await service.issueKey('m1', 'test');
    expect(result.raw.startsWith('xnd_test_')).toBe(true);
    expect(result.fingerprint.startsWith('xnd_test_')).toBe(true);
    expect(inserts).toHaveLength(1);
  });

  it('refuses a live key with KYB_NOT_VERIFIED for an unverified merchant', async () => {
    const { db } = makeFakeDb({
      merchantRows: [merchantRow({ kybStatus: 'pending' })],
      settlementRows: [settlementRow()],
    });
    const service = new KeyIssuanceService(db);
    await expect(service.issueKey('m1', 'live')).rejects.toMatchObject({
      code: 'KYB_NOT_VERIFIED',
    });
  });

  it('refuses a live key with SETTLEMENT_DESTINATION_MISSING for a verified merchant with no settlement account', async () => {
    const { db } = makeFakeDb({
      merchantRows: [merchantRow({ kybStatus: 'verified' })],
      settlementRows: [],
    });
    const service = new KeyIssuanceService(db);
    await expect(service.issueKey('m1', 'live')).rejects.toMatchObject({
      code: 'SETTLEMENT_DESTINATION_MISSING',
    });
  });

  it('refuses a live key when the settlement account has no provider_reference', async () => {
    const { db } = makeFakeDb({
      merchantRows: [merchantRow({ kybStatus: 'verified' })],
      settlementRows: [settlementRow({ providerReference: null })],
    });
    const service = new KeyIssuanceService(db);
    await expect(service.issueKey('m1', 'live')).rejects.toMatchObject({
      code: 'SETTLEMENT_DESTINATION_MISSING',
    });
  });

  it('issues a live key once KYB is verified and a provider reference exists', async () => {
    const { db, inserts } = makeFakeDb({
      merchantRows: [merchantRow({ kybStatus: 'verified' })],
      settlementRows: [settlementRow()],
    });
    const service = new KeyIssuanceService(db);
    const result = await service.issueKey('m1', 'live');
    expect(result.raw.startsWith('xnd_live_')).toBe(true);
    expect(inserts).toHaveLength(1);
  });

  it('rejects an unknown merchant', async () => {
    const { db } = makeFakeDb({ merchantRows: [] });
    const service = new KeyIssuanceService(db);
    await expect(service.issueKey('ghost', 'test')).rejects.toMatchObject({
      code: 'MERCHANT_NOT_FOUND',
    });
  });
});

describe('KeyIssuanceService.markKybVerified', () => {
  it('stamps kyb_status verified and a kyb_verified_at timestamp', async () => {
    const { db, updates } = makeFakeDb({ merchantRows: [merchantRow()] });
    const service = new KeyIssuanceService(db);
    await service.markKybVerified('m1');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ kybStatus: 'verified' });
    expect(
      (updates[0] as { kybVerifiedAt: Date }).kybVerifiedAt,
    ).toBeInstanceOf(Date);
  });
});
