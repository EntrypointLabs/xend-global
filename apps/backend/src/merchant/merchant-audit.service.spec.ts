import type { DbService } from '../db/db.service';
import { MerchantAuditService } from './merchant-audit.service';

function makeDb(queue: unknown[][], inserts: unknown[] = []) {
  const calls = [...queue];
  const client = {
    insert: () => ({
      values: (v: unknown) => {
        inserts.push(v);
        return Promise.resolve();
      },
    }),
    select: () => {
      const rows = calls.shift() ?? [];
      const chain: Record<string, unknown> = {};
      for (const method of ['from', 'where', 'orderBy', 'limit']) {
        chain[method] = () => chain;
      }
      chain.then = (resolve: (v: unknown) => unknown) => resolve(rows);
      return chain;
    },
  };
  return { db: { client } as unknown as DbService, inserts };
}

describe('MerchantAuditService', () => {
  it('appends an entry scoped to the Merchant', async () => {
    const { db, inserts } = makeDb([]);
    const service = new MerchantAuditService(db);
    await service.record({
      merchantId: 'm1',
      actor: 'owner-1',
      action: 'profile.update',
      target: 'm1',
      metadata: { version: '2' },
    });
    expect(inserts[0]).toMatchObject({
      merchantId: 'm1',
      actor: 'owner-1',
      action: 'profile.update',
      target: 'm1',
      metadata: { version: '2' },
    });
  });

  it('returns a page with a nextCursor when more rows remain', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `a${i}`,
      action: 'api_key.issue',
      actor: 'owner-1',
      target: `k${i}`,
      metadata: null,
      at: new Date(`2026-01-0${i + 1}`),
    }));
    const { db } = makeDb([rows]);
    const service = new MerchantAuditService(db);
    const page = await service.list('m1', { limit: 2 });
    expect(page.entries).toHaveLength(2);
    expect(page.nextCursor).toBe('a1');
    expect(page.entries[0].at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('maps the stored actor to a safe label, never the raw provider id', async () => {
    const { db } = makeDb([
      [
        {
          id: 'a0',
          action: 'profile.update',
          actor: 'did:privy:owner-secret',
          target: 'm1',
          metadata: null,
          at: new Date('2026-01-02'),
        },
        {
          id: 'a1',
          action: 'webhook.create',
          actor: 'api_key:ak_123',
          target: 'wh1',
          metadata: null,
          at: new Date('2026-01-01'),
        },
      ],
    ]);
    const service = new MerchantAuditService(db);
    const page = await service.list('m1', { limit: 25 });
    expect(page.entries[0].actor).toBe('Owner');
    expect(page.entries[1].actor).toBe('API key');
    // The raw Privy provider id never reaches the feed.
    expect(JSON.stringify(page.entries)).not.toContain('owner-secret');
  });

  it('returns a null cursor when the page is not full', async () => {
    const { db } = makeDb([
      [
        {
          id: 'a0',
          action: 'kyb.submit',
          actor: 'owner-1',
          target: 'm1',
          metadata: null,
          at: new Date('2026-01-01'),
        },
      ],
    ]);
    const service = new MerchantAuditService(db);
    const page = await service.list('m1', { limit: 25 });
    expect(page.nextCursor).toBeNull();
  });
});
