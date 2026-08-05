import { ExecutionContext, HttpException } from '@nestjs/common';
import type { DbService } from '../db/db.service';
import { apiKeys, merchants } from '../db/schema';
import { ApiKeyGuard, type MerchantRequest } from './api-key.guard';
import { generateApiKey } from './api-key.util';

type ApiKeyRow = typeof apiKeys.$inferSelect;
type MerchantRow = typeof merchants.$inferSelect;

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

function apiKeyRow(over: Partial<ApiKeyRow> = {}): ApiKeyRow {
  return {
    id: 'ak1',
    merchantId: 'm1',
    keyHash: 'hash',
    keyPrefix: 'xnd_test_',
    fingerprint: 'xnd_test_...abcd',
    mode: 'test',
    revokedAt: null,
    lastUsedAt: null,
    createdAt: new Date('2026-01-01'),
    ...over,
  };
}

function makeFakeDb(cfg: {
  apiKeyRows?: ApiKeyRow[];
  merchantRows?: MerchantRow[];
}) {
  const updatedSets: unknown[] = [];
  const selectChain = (rows: unknown[]) => ({
    where: () => ({ limit: () => Promise.resolve(rows) }),
  });
  const client = {
    select: () => ({
      from: (tbl: unknown) => {
        if (tbl === apiKeys) return selectChain(cfg.apiKeyRows ?? []);
        if (tbl === merchants) return selectChain(cfg.merchantRows ?? []);
        throw new Error('unknown table');
      },
    }),
    update: () => ({
      set: (v: unknown) => {
        updatedSets.push(v);
        return { where: () => Promise.resolve() };
      },
    }),
  };
  return { db: { client } as unknown as DbService, updatedSets };
}

function ctx(headers: Record<string, string>): {
  context: ExecutionContext;
  request: MerchantRequest;
} {
  const request = { headers } as unknown as MerchantRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

async function expectRejectHttp(
  p: Promise<unknown>,
  status: number,
  code: string,
) {
  try {
    await p;
    throw new Error('expected rejection');
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    const http = err as HttpException;
    expect(http.getStatus()).toBe(status);
    expect(http.getResponse()).toMatchObject({ code });
  }
}

describe('ApiKeyGuard', () => {
  it('attaches { merchantId, apiKeyId, mode } for a valid active-merchant key', async () => {
    const key = generateApiKey('test');
    const { db } = makeFakeDb({
      apiKeyRows: [apiKeyRow({ keyHash: key.keyHash })],
      merchantRows: [merchantRow()],
    });
    const guard = new ApiKeyGuard(db);
    const { context, request } = ctx({ authorization: `Bearer ${key.raw}` });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.merchant).toEqual({
      merchantId: 'm1',
      apiKeyId: 'ak1',
      mode: 'test',
    });
  });

  it('reads x-api-key as a fallback', async () => {
    const key = generateApiKey('live');
    const { db } = makeFakeDb({
      apiKeyRows: [apiKeyRow({ keyHash: key.keyHash, mode: 'live' })],
      merchantRows: [merchantRow()],
    });
    const guard = new ApiKeyGuard(db);
    const { context, request } = ctx({ 'x-api-key': key.raw });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.merchant.mode).toBe('live');
  });

  it('hashes the raw key: the request never carries the raw value', async () => {
    const key = generateApiKey('test');
    const { db } = makeFakeDb({
      apiKeyRows: [apiKeyRow({ keyHash: key.keyHash })],
      merchantRows: [merchantRow()],
    });
    const guard = new ApiKeyGuard(db);
    const { context, request } = ctx({ authorization: `Bearer ${key.raw}` });
    await guard.canActivate(context);
    expect(JSON.stringify(request.merchant)).not.toContain(key.raw);
  });

  it('rejects a missing header with 401 INVALID_API_KEY', async () => {
    const { db } = makeFakeDb({});
    const guard = new ApiKeyGuard(db);
    await expectRejectHttp(
      guard.canActivate(ctx({}).context),
      401,
      'INVALID_API_KEY',
    );
  });

  it('rejects a wrong-prefix key with 401', async () => {
    const { db } = makeFakeDb({});
    const guard = new ApiKeyGuard(db);
    await expectRejectHttp(
      guard.canActivate(ctx({ authorization: 'Bearer sk_live_nope' }).context),
      401,
      'INVALID_API_KEY',
    );
  });

  it('rejects an unknown key hash with 401', async () => {
    const key = generateApiKey('test');
    const { db } = makeFakeDb({ apiKeyRows: [] });
    const guard = new ApiKeyGuard(db);
    await expectRejectHttp(
      guard.canActivate(ctx({ authorization: `Bearer ${key.raw}` }).context),
      401,
      'INVALID_API_KEY',
    );
  });

  it('rejects a revoked key with 401', async () => {
    const key = generateApiKey('test');
    const { db } = makeFakeDb({
      apiKeyRows: [apiKeyRow({ keyHash: key.keyHash, revokedAt: new Date() })],
      merchantRows: [merchantRow()],
    });
    const guard = new ApiKeyGuard(db);
    await expectRejectHttp(
      guard.canActivate(ctx({ authorization: `Bearer ${key.raw}` }).context),
      401,
      'INVALID_API_KEY',
    );
  });

  it('rejects a suspended merchant with 403 MERCHANT_SUSPENDED', async () => {
    const key = generateApiKey('test');
    const { db } = makeFakeDb({
      apiKeyRows: [apiKeyRow({ keyHash: key.keyHash })],
      merchantRows: [merchantRow({ status: 'suspended' })],
    });
    const guard = new ApiKeyGuard(db);
    await expectRejectHttp(
      guard.canActivate(ctx({ authorization: `Bearer ${key.raw}` }).context),
      403,
      'MERCHANT_SUSPENDED',
    );
  });
});
