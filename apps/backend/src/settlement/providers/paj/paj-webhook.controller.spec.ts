import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../../../db/db.service';
import type { InboundWebhookDedupe } from '../../../db/inbound-webhook-dedupe';
import type { EventPublisher } from '../../../events/event-publisher.interface';
import type { SettlementConfirmationService } from '../../settlement-confirmation.service';
import type { PajClient } from './paj.client';
import type {
  PajOfframpEvent,
  PajSettlementProvider,
} from './paj-settlement.provider';
import { PajWebhookController } from './paj-webhook.controller';

const RAW = Buffer.from('{"id":"tx_9"}');
const NOW = () => String(Math.floor(Date.now() / 1000));

const PAID: PajOfframpEvent = {
  type: 'paid',
  eventId: 'tx_9:COMPLETED',
  depositSignature: 'sig_1',
  providerTxRef: 'tx_9',
  ngnSettledMinor: '3440250',
  fxRate: '1376.08',
};

function setup(opts: {
  event?: PajOfframpEvent | null;
  rows?: unknown[];
  verifyThrows?: boolean;
  replay?: boolean;
  dbThrows?: boolean;
  killSwitch?: boolean;
}) {
  const sets: Record<string, unknown>[] = [];
  const client = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        sets.push(values);
        const result = () =>
          opts.dbThrows
            ? Promise.reject(new Error('db down'))
            : Promise.resolve(opts.rows ?? []);
        return {
          where: () => ({
            returning: () => result(),
            then: (
              res: (v: unknown) => unknown,
              rej?: (e: unknown) => unknown,
            ) => result().then(res, rej),
          }),
        };
      },
    }),
  };
  const verify = jest.fn(() => {
    if (opts.verifyThrows)
      throw new HttpException('invalid webhook signature', 401);
  });
  const complete = jest.fn().mockResolvedValue(undefined);
  const publish = jest.fn().mockResolvedValue(undefined);
  const claim = jest.fn().mockResolvedValue(!opts.replay);
  const release = jest.fn().mockResolvedValue(undefined);

  const controller = new PajWebhookController(
    { client } as unknown as DbService,
    { verifyWebhookSignature: verify } as unknown as PajClient,
    {
      parseWebhookEvent: () => (opts.event === undefined ? PAID : opts.event),
    } as unknown as PajSettlementProvider,
    {
      completeDeferredSettlement: complete,
    } as unknown as SettlementConfirmationService,
    { publish } as unknown as EventPublisher,
    {
      get: (key: string) =>
        key === 'SETTLEMENT_WEBHOOK_KILLSWITCH'
          ? opts.killSwitch === true
          : undefined,
    } as unknown as ConfigService,
    { claim, release } as unknown as InboundWebhookDedupe,
  );
  return { controller, sets, verify, complete, publish, claim, release };
}

const OFFRAMP = { id: 'so_1', paymentId: 'pay_1', merchantId: 'm_1' };

describe('PajWebhookController', () => {
  it('completes the Payment when the naira lands', async () => {
    const { controller, sets, complete, publish } = setup({ rows: [OFFRAMP] });

    await expect(
      controller.receive({ rawBody: RAW }, NOW(), 'v1=abc', {}),
    ).resolves.toEqual({ ok: true });

    expect(sets[0]).toMatchObject({
      status: 'paid',
      ngnAmountMinor: '3440250',
      fxRate: '1376.08',
    });
    expect(complete).toHaveBeenCalledWith(
      'pay_1',
      expect.objectContaining({
        status: 'complete',
        ngnSettledMinor: '3440250',
        providerTxRef: 'tx_9',
      }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'payout.completed' }),
    );
  });

  it('does nothing for a payout that is already terminal or unknown', async () => {
    const { controller, complete, publish } = setup({ rows: [] });

    await controller.receive({ rawBody: RAW }, NOW(), 'v1=abc', {});

    expect(complete).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('marks a failed payout without completing the Payment', async () => {
    const { controller, sets, complete, publish } = setup({
      event: { ...PAID, type: 'failed', eventId: 'tx_9:ERROR' },
      rows: [OFFRAMP],
    });

    await controller.receive({ rawBody: RAW }, NOW(), 'v1=abc', {});

    expect(sets[0]).toMatchObject({ status: 'failed' });
    expect(complete).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'payout.failed' }),
    );
  });

  it('rejects a bad signature before claiming or writing', async () => {
    const { controller, sets, claim } = setup({ verifyThrows: true });

    await expect(
      controller.receive({ rawBody: RAW }, NOW(), 'v1=bad', {}),
    ).rejects.toThrow('invalid webhook signature');
    expect(claim).not.toHaveBeenCalled();
    expect(sets).toEqual([]);
  });

  it('rejects a delivery whose raw body is unavailable', async () => {
    const { controller, verify } = setup({});

    await expect(controller.receive({}, NOW(), 'v1=abc', {})).rejects.toThrow(
      'invalid webhook signature',
    );
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects a correctly signed delivery that is too old', async () => {
    const { controller, claim } = setup({});
    const stale = String(Math.floor(Date.now() / 1000) - 3600);

    await expect(
      controller.receive({ rawBody: RAW }, stale, 'v1=abc', {}),
    ).rejects.toThrow('timestamp outside tolerance');
    expect(claim).not.toHaveBeenCalled();
  });

  it('acknowledges a replayed delivery without acting on it', async () => {
    const { controller, sets } = setup({ replay: true, rows: [OFFRAMP] });

    await expect(
      controller.receive({ rawBody: RAW }, NOW(), 'v1=abc', {}),
    ).resolves.toEqual({ ok: true, replayed: true });
    expect(sets).toEqual([]);
  });

  it('acknowledges deliveries it does not own', async () => {
    const { controller, claim } = setup({ event: null });

    await expect(
      controller.receive({ rawBody: RAW }, NOW(), 'v1=abc', {}),
    ).resolves.toEqual({ ok: true, skipped: true });
    expect(claim).not.toHaveBeenCalled();
  });

  it('releases its claim and asks for redelivery when recording fails', async () => {
    const { controller, release } = setup({ dbThrows: true });

    await expect(
      controller.receive({ rawBody: RAW }, NOW(), 'v1=abc', {}),
    ).rejects.toThrow('retry requested');
    expect(release).toHaveBeenCalledWith('paj', 'tx_9:COMPLETED');
  });

  it('acknowledges without verifying while the kill switch is on', async () => {
    const { controller, verify } = setup({ killSwitch: true });

    await expect(
      controller.receive({ rawBody: RAW }, NOW(), 'v1=abc', {}),
    ).resolves.toEqual({ ok: true, killSwitched: true });
    expect(verify).not.toHaveBeenCalled();
  });
});
