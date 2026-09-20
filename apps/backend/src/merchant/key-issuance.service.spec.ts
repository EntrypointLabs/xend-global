import type { DbService } from '../db/db.service';
import { ConfigService } from '@nestjs/config';
import { merchants, settlementAccounts } from '../db/schema';
import { KeyIssuanceService } from './key-issuance.service';

type MerchantRow = typeof merchants.$inferSelect;
type SettlementRow = typeof settlementAccounts.$inferSelect;

function merchantRow(over: Partial<MerchantRow> = {}): MerchantRow {
  return {
    businessProfile: {},
    profileVersion: 0,
    ownerProviderId: null,
    receivingWallet: null,
    settlementTermsAcceptedAt: null,
    id: 'm1',
    name: 'Acme',
    displayName: 'Acme Store',
    status: 'active',
    intentTtlMinutes: null,
    allowedOrigins: null,
    kybStatus: 'pending',
    kybVerifiedAt: null,
    kybSubmittedAt: null,
    kybSubmittedVersion: null,
    kybReviewNote: null,
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
    executionCluster: 'mainnet',
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
        return {
          returning: () => Promise.resolve([{ id: 'ak-new' }]),
        };
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
  it('binds devnet execution to devnet without marking the Merchant verified', async () => {
    const { db, inserts, updates } = makeFakeDb({
      merchantRows: [merchantRow()],
      settlementRows: [settlementRow()],
    });
    const service = new KeyIssuanceService(
      db,
      new ConfigService({
        NODE_ENV: 'development',
        SOLANA_CLUSTER: 'devnet',
        DEVNET_PAYMENTS_ENABLED: true,
      }),
    );
    await service.issueKey('m1', 'devnet');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toMatchObject({
      mode: 'live',
      executionCluster: 'devnet',
    });
    expect(updates).toEqual([]);
  });

  it.each([
    ['production', 'devnet', true],
    ['development', 'mainnet-beta', true],
    ['development', 'devnet', false],
  ])(
    'refuses devnet issuance with %s/%s/enabled=%s',
    async (env, cluster, enabled) => {
      const { db, inserts } = makeFakeDb({
        merchantRows: [merchantRow()],
        settlementRows: [settlementRow()],
      });
      const service = new KeyIssuanceService(
        db,
        new ConfigService({
          NODE_ENV: env,
          SOLANA_CLUSTER: cluster,
          DEVNET_PAYMENTS_ENABLED: enabled,
        }),
      );
      await expect(service.issueKey('m1', 'devnet')).rejects.toMatchObject({
        code: 'KYB_NOT_VERIFIED',
      });
      expect(inserts).toEqual([]);
    },
  );

  it('requires a provisioned destination for devnet execution', async () => {
    const { db, inserts } = makeFakeDb({ merchantRows: [merchantRow()] });
    const service = new KeyIssuanceService(
      db,
      new ConfigService({
        NODE_ENV: 'development',
        SOLANA_CLUSTER: 'devnet',
        DEVNET_PAYMENTS_ENABLED: true,
      }),
    );
    await expect(service.issueKey('m1', 'devnet')).rejects.toMatchObject({
      code: 'SETTLEMENT_DESTINATION_MISSING',
    });
    expect(inserts).toEqual([]);
  });

  it('refuses a normal live key on a devnet deployment', async () => {
    const { db, inserts } = makeFakeDb({
      merchantRows: [merchantRow({ kybStatus: 'verified' })],
      settlementRows: [settlementRow({ executionCluster: 'devnet' })],
    });
    const service = new KeyIssuanceService(
      db,
      new ConfigService({
        NODE_ENV: 'development',
        SOLANA_CLUSTER: 'devnet',
        DEVNET_PAYMENTS_ENABLED: false,
      }),
    );

    await expect(service.issueKey('m1', 'live')).rejects.toMatchObject({
      code: 'EXECUTION_CLUSTER_DISABLED',
    });
    expect(inserts).toEqual([]);
  });

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
    expect(inserts[0].values).toMatchObject({
      mode: 'live',
      executionCluster: 'mainnet',
    });
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
  it('stamps verified when the submitted version matches the current profile', async () => {
    const { db, updates } = makeFakeDb({
      merchantRows: [
        merchantRow({ profileVersion: 2, kybSubmittedVersion: 2 }),
      ],
    });
    const service = new KeyIssuanceService(db);
    await service.markKybVerified('m1');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ kybStatus: 'verified' });
    expect(
      (updates[0] as { kybVerifiedAt: Date }).kybVerifiedAt,
    ).toBeInstanceOf(Date);
  });

  it('refuses to verify a profile changed since it was submitted', async () => {
    const { db, updates } = makeFakeDb({
      merchantRows: [
        merchantRow({ profileVersion: 3, kybSubmittedVersion: 2 }),
      ],
    });
    const service = new KeyIssuanceService(db);
    await expect(service.markKybVerified('m1')).rejects.toMatchObject({
      code: 'KYB_SUBMISSION_MISMATCH',
    });
    expect(updates).toEqual([]);
  });

  it('refuses to verify a merchant that never submitted', async () => {
    const { db } = makeFakeDb({
      merchantRows: [merchantRow({ kybSubmittedVersion: null })],
    });
    const service = new KeyIssuanceService(db);
    await expect(service.markKybVerified('m1')).rejects.toMatchObject({
      code: 'KYB_SUBMISSION_MISMATCH',
    });
  });

  it('refuses to re-verify a rejected merchant whose submitted version still matches', async () => {
    // Rejection leaves kyb_submitted_version equal to profile_version, so only
    // the pending-state guard stops a repeated verify from re-enabling keys.
    const { db, updates } = makeFakeDb({
      merchantRows: [
        merchantRow({
          kybStatus: 'rejected',
          profileVersion: 2,
          kybSubmittedVersion: 2,
        }),
      ],
    });
    const service = new KeyIssuanceService(db);
    await expect(service.markKybVerified('m1')).rejects.toMatchObject({
      code: 'KYB_SUBMISSION_MISMATCH',
    });
    expect(updates).toEqual([]);
  });
});

describe('KeyIssuanceService.markKybRejected', () => {
  it('stamps kyb_status rejected with the reviewer note and clears verification', async () => {
    const { db, updates } = makeFakeDb({
      merchantRows: [
        merchantRow({
          kybStatus: 'pending',
          profileVersion: 2,
          kybSubmittedVersion: 2,
        }),
      ],
    });
    const service = new KeyIssuanceService(db);
    await service.markKybRejected('m1', 'Address does not match documents');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      kybStatus: 'rejected',
      kybReviewNote: 'Address does not match documents',
      kybVerifiedAt: null,
    });
  });

  it('refuses to reject a profile changed since it was submitted', async () => {
    const { db, updates } = makeFakeDb({
      merchantRows: [
        merchantRow({
          kybStatus: 'pending',
          profileVersion: 3,
          kybSubmittedVersion: 2,
        }),
      ],
    });
    const service = new KeyIssuanceService(db);
    await expect(service.markKybRejected('m1', 'stale')).rejects.toMatchObject({
      code: 'KYB_SUBMISSION_MISMATCH',
    });
    expect(updates).toEqual([]);
  });

  it('refuses to reject a merchant that is not pending review', async () => {
    const { db, updates } = makeFakeDb({
      merchantRows: [
        merchantRow({
          kybStatus: 'verified',
          profileVersion: 2,
          kybSubmittedVersion: 2,
        }),
      ],
    });
    const service = new KeyIssuanceService(db);
    await expect(service.markKybRejected('m1', 'oops')).rejects.toMatchObject({
      code: 'KYB_SUBMISSION_MISMATCH',
    });
    expect(updates).toEqual([]);
  });

  it('rejects an unknown merchant', async () => {
    const { db } = makeFakeDb({ merchantRows: [] });
    const service = new KeyIssuanceService(db);
    await expect(service.markKybRejected('ghost', 'x')).rejects.toMatchObject({
      code: 'MERCHANT_NOT_FOUND',
    });
  });
});

describe('KeyIssuanceService.revokeKey', () => {
  function revokeDb(cfg: { unrevoked: boolean; existing: boolean }) {
    const revokedAt = new Date('2026-02-01');
    const row = {
      id: 'ak1',
      merchantId: 'm1',
      keyHash: 'h',
      keyPrefix: 'xnd_live_',
      fingerprint: 'xnd_live_...abcd',
      mode: 'live' as const,
      revokedAt,
      lastUsedAt: null,
      createdAt: new Date('2026-01-01'),
    };
    const client = {
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve(cfg.unrevoked ? [row] : []),
          }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(cfg.existing ? [row] : []),
          }),
        }),
      }),
    };
    return { db: { client } as unknown as DbService, revokedAt };
  }

  it('stamps revoked_at on a live key', async () => {
    const { db, revokedAt } = revokeDb({ unrevoked: true, existing: true });
    const svc = new KeyIssuanceService(db);
    await expect(svc.revokeKey('ak1')).resolves.toMatchObject({
      id: 'ak1',
      fingerprint: 'xnd_live_...abcd',
      revokedAt,
      claimed: true,
    });
  });

  it('is safe to repeat: an already revoked key keeps its first timestamp and is not re-claimed', async () => {
    const { db, revokedAt } = revokeDb({ unrevoked: false, existing: true });
    const svc = new KeyIssuanceService(db);
    await expect(svc.revokeKey('ak1')).resolves.toMatchObject({
      revokedAt,
      claimed: false,
    });
  });

  it('refuses an unknown key', async () => {
    const { db } = revokeDb({ unrevoked: false, existing: false });
    const svc = new KeyIssuanceService(db);
    await expect(svc.revokeKey('ghost')).rejects.toMatchObject({
      code: 'API_KEY_NOT_FOUND',
    });
  });
});
