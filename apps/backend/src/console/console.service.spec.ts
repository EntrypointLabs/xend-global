import type { DbService } from '../db/db.service';
import { ConsoleService, formatUsdc, formatNgn } from './console.service';
import { escapeHtml } from './console-html';

/**
 * A fake db whose select chain resolves to `rows` at the terminal `.limit()`.
 * Every intermediate builder method returns the same chain so any length of
 * .from/.leftJoin/.orderBy is accepted.
 */
function makeDb(rows: unknown[]): DbService {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'leftJoin', 'innerJoin', 'where', 'orderBy']) {
    chain[method] = () => chain;
  }
  chain.limit = () => Promise.resolve(rows);
  const client = { select: () => chain };
  return { client } as unknown as DbService;
}

describe('ConsoleService formatting', () => {
  it('formats USDC via BigInt division, trimming trailing zeros', () => {
    expect(formatUsdc('50000000')).toBe('50');
    expect(formatUsdc('1500000')).toBe('1.5');
    expect(formatUsdc('1234567')).toBe('1.234567');
    expect(formatUsdc('0')).toBe('0');
  });

  it('formats NGN minor units (kobo) via BigInt division', () => {
    expect(formatNgn('5000')).toBe('50');
    expect(formatNgn('150')).toBe('1.5');
    expect(formatNgn('12345')).toBe('123.45');
  });
});

describe('escapeHtml', () => {
  it('neutralizes a script tag in a merchant name', () => {
    const escaped = escapeHtml('<script>alert(1)</script>');
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
  });

  it('escapes quotes and ampersands', () => {
    expect(escapeHtml(`A & B "C" 'D'`)).toBe(
      'A &amp; B &quot;C&quot; &#39;D&#39;',
    );
  });
});

describe('ConsoleService.listPayments', () => {
  it('maps rows to view models with BigInt-formatted amounts and truncated signature', async () => {
    const svc = new ConsoleService(
      makeDb([
        {
          id: 'pay_1',
          merchantName: 'Cafe Neo',
          usdcAmount: '50000000',
          ngnAmount: '8000000',
          intentStatus: 'succeeded',
          signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          settledAt: new Date('2026-07-11T10:00:00.000Z'),
          refundOfPaymentId: null,
        },
      ]),
    );
    const [row] = await svc.listPayments();
    expect(row).toMatchObject({
      id: 'pay_1',
      merchantName: 'Cafe Neo',
      usdcAmount: '50',
      ngnAmount: '80000',
      intentStatus: 'succeeded',
      refundOfPaymentId: null,
    });
    expect(row.signature).toContain('…');
  });

  it('carries null NGN and null merchant name through unchanged', async () => {
    const svc = new ConsoleService(
      makeDb([
        {
          id: 'pay_2',
          merchantName: null,
          usdcAmount: '1500000',
          ngnAmount: null,
          intentStatus: null,
          signature: null,
          settledAt: null,
          refundOfPaymentId: 'pay_1',
        },
      ]),
    );
    const [row] = await svc.listPayments();
    expect(row.usdcAmount).toBe('1.5');
    expect(row.ngnAmount).toBeNull();
    expect(row.merchantName).toBeNull();
    expect(row.signature).toBeNull();
    expect(row.refundOfPaymentId).toBe('pay_1');
  });
});

describe('ConsoleService.listDeliveries', () => {
  it('returns delivery view rows joined to the endpoint url', async () => {
    const created = new Date('2026-07-11T09:00:00.000Z');
    const svc = new ConsoleService(
      makeDb([
        {
          id: 'del_1',
          eventId: 'evt_1',
          eventType: 'payment.succeeded',
          endpointUrl: 'https://merchant.example/hook',
          attemptNo: 2,
          status: 'failed',
          responseStatus: 500,
          durationMs: 1200,
          nextRetryAt: null,
          createdAt: created,
        },
      ]),
    );
    const [row] = await svc.listDeliveries();
    expect(row).toMatchObject({
      id: 'del_1',
      eventId: 'evt_1',
      endpointUrl: 'https://merchant.example/hook',
      attemptNo: 2,
      status: 'failed',
    });
  });
});

describe('ConsoleService.listKeyFingerprints', () => {
  it('returns fingerprint view rows joined to the merchant', async () => {
    const svc = new ConsoleService(
      makeDb([
        {
          merchantName: 'Cafe Neo',
          fingerprint: 'xnd_live_...abcd',
          mode: 'live',
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          lastUsedAt: null,
          revokedAt: null,
        },
      ]),
    );
    const [row] = await svc.listKeyFingerprints();
    expect(row.fingerprint).toBe('xnd_live_...abcd');
    expect(row.merchantName).toBe('Cafe Neo');
  });
});
