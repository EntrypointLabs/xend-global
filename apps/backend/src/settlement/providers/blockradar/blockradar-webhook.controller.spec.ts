import { HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../../../db/db.service';
import type { InboundWebhookDedupe } from '../../../db/inbound-webhook-dedupe';
import type { EventPublisher } from '../../../events/event-publisher.interface';
import type { SettlementConfirmationService } from '../../settlement-confirmation.service';
import { BlockradarWebhookController } from './blockradar-webhook.controller';
import type { BlockradarSettlementProvider } from './blockradar-settlement.provider';
import type { OfframpWebhookEvent } from './blockradar-settlement.provider';

const RAW = Buffer.from(JSON.stringify({ event: 'offramp.success' }));

function makeDedupe(opts: { replay?: boolean } = {}): {
  dedupe: InboundWebhookDedupe;
  claimed: string[];
  released: string[];
} {
  const claimed: string[] = [];
  const released: string[] = [];
  const dedupe = {
    claim: (_provider: string, eventId: string) => {
      claimed.push(eventId);
      return Promise.resolve(!opts.replay);
    },
    release: (_provider: string, eventId: string) => {
      released.push(eventId);
      return Promise.resolve();
    },
  } as unknown as InboundWebhookDedupe;
  return { dedupe, claimed, released };
}

function makeDb(opts: {
  updateReturning?: unknown[];
  updateThrows?: boolean;
}): { db: DbService; updateCalled: () => number } {
  let calls = 0;
  const client = {
    update: () => {
      calls++;
      return {
        set: () => ({
          where: () => {
            const result = () =>
              opts.updateThrows
                ? Promise.reject(new Error('db down'))
                : Promise.resolve(opts.updateReturning ?? []);
            return {
              returning: () => result(),
              then: (
                res: (v: unknown) => unknown,
                rej?: (e: unknown) => unknown,
              ) => result().then(res, rej),
            };
          },
        }),
      };
    },
  };
  return { db: { client } as unknown as DbService, updateCalled: () => calls };
}

function makeProvider(opts: {
  event?: OfframpWebhookEvent | null;
  verifyThrows?: boolean;
}): { provider: BlockradarSettlementProvider; verify: jest.Mock } {
  const verify = jest.fn(() => {
    if (opts.verifyThrows) throw new HttpException('bad sig', 401);
  });
  const provider = {
    verifyWebhookSignature: verify,
    parseWebhookEvent: jest.fn(() => opts.event ?? null),
  } as unknown as BlockradarSettlementProvider;
  return { provider, verify };
}

function makeConfirmation(): {
  confirmation: SettlementConfirmationService;
  complete: jest.Mock;
} {
  const complete = jest.fn().mockResolvedValue(undefined);
  return {
    confirmation: {
      completeDeferredSettlement: complete,
    } as unknown as SettlementConfirmationService,
    complete,
  };
}

function makePublisher(): { events: EventPublisher; publish: jest.Mock } {
  const publish = jest.fn().mockResolvedValue(undefined);
  return { events: { publish } as EventPublisher, publish };
}

const req = { rawBody: RAW } as unknown;

function makeConfig(killSwitch = false): ConfigService {
  return {
    get: (key: string) =>
      key === 'SETTLEMENT_WEBHOOK_KILLSWITCH' ? killSwitch : undefined,
  } as unknown as ConfigService;
}

describe('BlockradarWebhookController', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {});

  it('short-circuits on the kill switch before touching the provider', async () => {
    const { db } = makeDb({});
    const { provider, verify } = makeProvider({});
    const { confirmation } = makeConfirmation();
    const { events } = makePublisher();
    const ctrl = new BlockradarWebhookController(
      db,
      provider,
      confirmation,
      events,
      makeConfig(true),
      makeDedupe().dedupe,
    );
    const res = await ctrl.receive(req, 'sig', undefined, {});
    expect(res).toEqual({ ok: true, killSwitched: true });
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects a bad signature with 401 and zero DB access', async () => {
    const { db, updateCalled } = makeDb({});
    const { provider } = makeProvider({ verifyThrows: true });
    const { confirmation } = makeConfirmation();
    const { events } = makePublisher();
    const ctrl = new BlockradarWebhookController(
      db,
      provider,
      confirmation,
      events,
      makeConfig(),
      makeDedupe().dedupe,
    );
    await expect(
      ctrl.receive(req, 'bad', undefined, {}),
    ).rejects.toBeInstanceOf(HttpException);
    expect(updateCalled()).toBe(0);
  });

  it('drives completion through completeDeferredSettlement and publishes payout.completed on paid', async () => {
    const { db } = makeDb({
      updateReturning: [{ id: 'so_1', paymentId: 'pay_1', merchantId: 'm_1' }],
    });
    const { provider } = makeProvider({
      event: {
        type: 'paid',
        eventId: 'evt_1',
        providerRef: 'SIG_1',
        ngnSettledMinor: '8000000',
        fxRate: '1600',
        providerTxRef: 'ptx_1',
        completedAt: '2026-07-12T00:00:00.000Z',
      },
    });
    const { confirmation, complete } = makeConfirmation();
    const { events, publish } = makePublisher();
    const ctrl = new BlockradarWebhookController(
      db,
      provider,
      confirmation,
      events,
      makeConfig(),
      makeDedupe().dedupe,
    );
    const res = await ctrl.receive(req, 'sig', undefined, {});
    expect(res).toEqual({ ok: true });
    expect(complete).toHaveBeenCalledWith('pay_1', {
      status: 'complete',
      ngnSettledMinor: '8000000',
      completedAt: '2026-07-12T00:00:00.000Z',
      providerTxRef: 'ptx_1',
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'payout.completed' }),
    );
  });

  it('is a no-op on a replayed (already-terminal) paid event', async () => {
    const { db } = makeDb({ updateReturning: [] });
    const { provider } = makeProvider({
      event: {
        type: 'paid',
        eventId: 'evt_1',
        providerRef: 'SIG_1',
        ngnSettledMinor: '8000000',
      },
    });
    const { confirmation, complete } = makeConfirmation();
    const { events, publish } = makePublisher();
    const ctrl = new BlockradarWebhookController(
      db,
      provider,
      confirmation,
      events,
      makeConfig(),
      makeDedupe().dedupe,
    );
    const res = await ctrl.receive(req, 'sig', undefined, {});
    expect(res).toEqual({ ok: true });
    expect(complete).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes payout.failed and does NOT call completeDeferredSettlement on failed', async () => {
    const { db } = makeDb({
      updateReturning: [{ id: 'so_1', merchantId: 'm_1', paymentId: 'pay_1' }],
    });
    const { provider } = makeProvider({
      event: { type: 'failed', eventId: 'evt_1', providerRef: 'SIG_1' },
    });
    const { confirmation, complete } = makeConfirmation();
    const { events, publish } = makePublisher();
    const ctrl = new BlockradarWebhookController(
      db,
      provider,
      confirmation,
      events,
      makeConfig(),
      makeDedupe().dedupe,
    );
    await ctrl.receive(req, 'sig', undefined, {});
    expect(complete).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'payout.failed' }),
    );
  });

  it('throws 500 on an owned-event persistence failure so Blockradar redelivers', async () => {
    const { db } = makeDb({ updateThrows: true });
    const { provider } = makeProvider({
      event: {
        type: 'paid',
        eventId: 'evt_1',
        providerRef: 'SIG_1',
        ngnSettledMinor: '8000000',
      },
    });
    const { confirmation } = makeConfirmation();
    const { events } = makePublisher();
    const ctrl = new BlockradarWebhookController(
      db,
      provider,
      confirmation,
      events,
      makeConfig(),
      makeDedupe().dedupe,
    );
    await expect(
      ctrl.receive(req, 'sig', undefined, {}),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('acknowledges and skips an unowned (null-parsed) event', async () => {
    const { db, updateCalled } = makeDb({});
    const { provider } = makeProvider({ event: null });
    const { confirmation } = makeConfirmation();
    const { events } = makePublisher();
    const ctrl = new BlockradarWebhookController(
      db,
      provider,
      confirmation,
      events,
      makeConfig(),
      makeDedupe().dedupe,
    );
    const res = await ctrl.receive(req, 'sig', undefined, {});
    expect(res).toEqual({ ok: true, skipped: true });
    expect(updateCalled()).toBe(0);
  });

  it('acknowledges a replayed event id with no side effect', async () => {
    const { db, updateCalled } = makeDb({
      updateReturning: [{ id: 'so_1', paymentId: 'pay_1', merchantId: 'm_1' }],
    });
    const { provider } = makeProvider({
      event: { type: 'paid', eventId: 'evt_1', providerRef: 'SIG_1' },
    });
    const { confirmation, complete } = makeConfirmation();
    const { events, publish } = makePublisher();
    const { dedupe, claimed } = makeDedupe({ replay: true });
    const ctrl = new BlockradarWebhookController(
      db,
      provider,
      confirmation,
      events,
      makeConfig(),
      dedupe,
    );
    const res = await ctrl.receive(req, 'sig', undefined, {});
    expect(res).toEqual({ ok: true, replayed: true });
    expect(claimed).toEqual(['evt_1']);
    expect(updateCalled()).toBe(0);
    expect(complete).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('releases the claim when handling fails so the redelivery is not dropped', async () => {
    const { db } = makeDb({ updateThrows: true });
    const { provider } = makeProvider({
      event: { type: 'paid', eventId: 'evt_1', providerRef: 'SIG_1' },
    });
    const { confirmation } = makeConfirmation();
    const { events } = makePublisher();
    const { dedupe, released } = makeDedupe();
    const ctrl = new BlockradarWebhookController(
      db,
      provider,
      confirmation,
      events,
      makeConfig(),
      dedupe,
    );
    await expect(
      ctrl.receive(req, 'sig', undefined, {}),
    ).rejects.toBeInstanceOf(HttpException);
    expect(released).toEqual(['evt_1']);
  });

  it('rejects a delivery whose timestamp header is older than five minutes', async () => {
    const { db, updateCalled } = makeDb({});
    const { provider } = makeProvider({
      event: { type: 'paid', eventId: 'evt_1', providerRef: 'SIG_1' },
    });
    const { confirmation } = makeConfirmation();
    const { events } = makePublisher();
    const { dedupe, claimed } = makeDedupe();
    const ctrl = new BlockradarWebhookController(
      db,
      provider,
      confirmation,
      events,
      makeConfig(),
      dedupe,
    );
    const stale = String(Math.floor(Date.now() / 1000) - 6 * 60);
    await expect(ctrl.receive(req, 'sig', stale, {})).rejects.toMatchObject({
      status: 401,
    });
    expect(claimed).toEqual([]);
    expect(updateCalled()).toBe(0);

    const fresh = new Date().toISOString();
    await expect(ctrl.receive(req, 'sig', fresh, {})).resolves.toEqual({
      ok: true,
    });
  });
});
