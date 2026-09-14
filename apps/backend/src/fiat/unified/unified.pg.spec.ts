/** Opt-in real PostgreSQL and HTTP checks; only this test's random schema is touched. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication, ExecutionContext } from '@nestjs/common';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { DbService } from '../../db/db.service';
import { ConsumerAuthGuard } from '../../auth/consumer-auth.guard';
import * as schema from '../../db/schema';
import { UnifiedFiatService } from './unified.service';
import { UnifiedFiatController } from './unified.controller';

const describePg = process.env.FIAT_PG_TEST_DATABASE_URL
  ? describe
  : describe.skip;
describePg('unified fiat HTTP + PostgreSQL simulation', () => {
  const namespace = `unified_test_${randomBytes(6).toString('hex')}`;
  let admin: Pool;
  let pool: Pool;
  let app: INestApplication;
  let environment = 'test';
  let enabled = 'true';
  async function start() {
    const module = await Test.createTestingModule({
      controllers: [UnifiedFiatController],
      providers: [
        UnifiedFiatService,
        { provide: DbService, useValue: { client: drizzle(pool, { schema }) } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({ NODE_ENV: environment, FIAT_UNIFIED_SIMULATION: enabled })[
                key
              ],
          },
        },
      ],
    })
      .overrideGuard(ConsumerAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<{
            headers: Record<string, string>;
            user: { userId: string };
          }>();
          req.user = { userId: req.headers['x-test-consumer'] ?? 'alice' };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    await app.init();
  }
  beforeAll(async () => {
    admin = new Pool({
      connectionString: process.env.FIAT_PG_TEST_DATABASE_URL,
    });
    await admin.query(`CREATE SCHEMA "${namespace}"`);
    pool = new Pool({
      connectionString: process.env.FIAT_PG_TEST_DATABASE_URL,
      options: `-c search_path=${namespace}`,
      max: 8,
    });
    await pool.query('CREATE TABLE users (id text PRIMARY KEY)');
    await pool.query(
      readFileSync(
        'drizzle/0042_unified_fiat_simulation.sql',
        'utf8',
      ).replaceAll('"public".', `"${namespace}".`),
    );
    await pool.query("INSERT INTO users (id) VALUES ('alice'), ('bob')");
    await start();
  }, 20000);
  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
      await admin.end();
    }
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM fiat_unified_wallets');
    environment = 'test';
    enabled = 'true';
  });
  const http = () => request(app.getHttpServer() as Server);
  const receive = (
    currency: string,
    amountMinor: string,
    idempotencyKey = `receive-${currency}-001`,
  ) =>
    http()
      .post('/fiat/unified/receive')
      .send({ currency, amountMinor, idempotencyKey })
      .expect(201);
  const snapshot = () =>
    http().get('/fiat/unified?displayCurrency=USD').expect(200);
  const quote = (
    destinationCurrency: string,
    recipientMinor?: string,
    sendAll?: boolean,
  ) =>
    http()
      .post('/fiat/unified/quotes')
      .send({
        destinationCurrency,
        ...(recipientMinor ? { recipientMinor } : {}),
        ...(sendAll ? { sendAll } : {}),
        destination:
          destinationCurrency === 'NGN'
            ? '0123456789'
            : '11111111111111111111111111111111',
      })
      .expect(201);
  const order = (quoteId: string, idempotencyKey = 'create-order-001') =>
    http()
      .post('/fiat/unified/orders')
      .send({ quoteId, idempotencyKey })
      .expect(201);
  const advance = (id: string, idempotencyKey: string, action = 'advance') =>
    http()
      .post(`/fiat/unified/orders/${id}/advance`)
      .send({ action, idempotencyKey })
      .expect(201);
  async function seed() {
    await receive('NGN', '50000000');
    await receive('USDC', '100000000');
  }
  it('receives exact NGN/USDC, values both as USD, rejects duplicate credit conflicts and persists across restart', async () => {
    await seed();
    await receive('NGN', '50000000');
    const before = (await snapshot()).body;
    expect(before.mode).toBe('simulation');
    expect(before.total.totalMinor).toBe('40000');
    expect(before.holdings.NGN.settledMinor).toBe('50000000');
    expect(before.holdings.USDC.settledMinor).toBe('100000000');
    await http()
      .post('/fiat/unified/receive')
      .send({
        currency: 'NGN',
        amountMinor: '1',
        idempotencyKey: 'receive-NGN-001',
      })
      .expect(409);
    await app.close();
    await start();
    expect((await snapshot()).body.holdings).toEqual(before.holdings);
  });
  it('sends NGN using native money first and converts only the 100,000 NGN shortfall', async () => {
    await seed();
    const q = (await quote('NGN', '60000000')).body;
    expect(q.plan.directMinor).toBe('50000000');
    expect(q.plan.shortfallMinor).toBe('10000000');
    expect(q.plan.conversion.sourceDebitMinor).toBe('60000000');
    const o = (await order(q.id)).body;
    expect(o.status).toBe('converting');
    expect((await advance(o.id, 'convert-order-001')).body.status).toBe(
      'ready_to_send',
    );
    expect((await advance(o.id, 'send-order-001')).body.status).toBe('sending');
    expect((await advance(o.id, 'complete-order-001')).body.status).toBe(
      'completed',
    );
    const final = (await snapshot()).body.holdings;
    expect(final.NGN).toEqual({ settledMinor: '0', reservedMinor: '0' });
    expect(final.USDC).toEqual({
      settledMinor: '40000000',
      reservedMinor: '0',
    });
  });
  it('sends 150 USDC by adding a 50 USDC conversion to the existing 100 USDC', async () => {
    await seed();
    const q = (await quote('USDC', '150000000')).body;
    expect(q.plan.directMinor).toBe('100000000');
    expect(q.plan.shortfallMinor).toBe('50000000');
    const o = (await order(q.id)).body;
    for (const key of ['convert-150-001', 'send-150-001', 'complete-150-001'])
      await advance(o.id, key);
    const final = (await snapshot()).body.holdings;
    expect(final.USDC).toEqual({ settledMinor: '0', reservedMinor: '0' });
    expect(BigInt(final.NGN.settledMinor)).toBe(
      50000000n - BigInt(q.plan.conversion.sourceDebitMinor),
    );
  });
  it('NGN-only conversion debits NGN before payout and never leaves converted funds spendable twice', async () => {
    await receive('NGN', '50000000');
    const q = (await quote('USDC', '100000000')).body;
    const o = (await order(q.id)).body;
    const reserved = (await snapshot()).body.holdings;
    expect(reserved.USDC.settledMinor).toBe('0');
    expect(reserved.NGN.reservedMinor).toBe('16666667');
    await advance(o.id, 'ngn-only-conversion-001');
    const converted = (await snapshot()).body.holdings;
    expect(converted.NGN).toEqual({
      settledMinor: '33333333',
      reservedMinor: '0',
    });
    expect(converted.USDC).toEqual({
      settledMinor: '100000000',
      reservedMinor: '100000000',
    });
    await advance(o.id, 'ngn-only-send-001');
    await advance(o.id, 'ngn-only-delivered-001');
    const delivered = (await snapshot()).body.holdings;
    expect(delivered.NGN).toEqual({
      settledMinor: '33333333',
      reservedMinor: '0',
    });
    expect(delivered.USDC).toEqual({ settledMinor: '0', reservedMinor: '0' });
  });
  it('direct sends avoid conversion; completion and action replay do not debit twice', async () => {
    await seed();
    const q = (await quote('USDC', '10000000')).body;
    expect(q.plan.conversion).toBeNull();
    const o = (await order(q.id)).body;
    expect(o.status).toBe('ready_to_send');
    expect((await order(q.id)).body.id).toBe(o.id);
    await advance(o.id, 'send-direct-001');
    await advance(o.id, 'send-direct-001');
    await advance(o.id, 'finish-direct-001');
    await advance(o.id, 'finish-direct-001');
    expect((await snapshot()).body.holdings.USDC.settledMinor).toBe('90000000');
    await http()
      .post(`/fiat/unified/orders/${o.id}/advance`)
      .send({ action: 'fail', idempotencyKey: 'finish-direct-001' })
      .expect(409);
  });
  it('send-all reserves both assets and completes a single 400 USDC intent', async () => {
    await seed();
    const q = (await quote('USDC', undefined, true)).body;
    expect(q.plan.recipientMinor).toBe('400000000');
    const o = (await order(q.id)).body;
    for (const key of ['convert-all-001', 'send-all-001', 'finish-all-001'])
      await advance(o.id, key);
    expect((await snapshot()).body.total.totalMinor).toBe('0');
  });
  it('failure after conversion retains converted funds and releases every reservation', async () => {
    await seed();
    const q = (await quote('USDC', '150000000')).body;
    const o = (await order(q.id)).body;
    await advance(o.id, 'convert-fail-001');
    await advance(o.id, 'send-fail-001');
    expect((await advance(o.id, 'fail-fail-001', 'fail')).body.status).toBe(
      'failed',
    );
    const final = (await snapshot()).body.holdings;
    expect(final.USDC).toEqual({
      settledMinor: '150000000',
      reservedMinor: '0',
    });
    expect(final.NGN.reservedMinor).toBe('0');
    expect(BigInt(final.NGN.settledMinor)).toBeLessThan(50000000n);
  });
  it('serializes concurrent reservations so two orders cannot overspend the same holdings', async () => {
    await receive('USDC', '100000000');
    const q1 = (await quote('USDC', '80000000')).body;
    const q2 = (await quote('USDC', '80000000')).body;
    const responses = await Promise.all([
      http()
        .post('/fiat/unified/orders')
        .send({ quoteId: q1.id, idempotencyKey: 'competing-order-001' }),
      http()
        .post('/fiat/unified/orders')
        .send({ quoteId: q2.id, idempotencyKey: 'competing-order-002' }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await snapshot()).body.holdings.USDC.reservedMinor).toBe(
      '80000000',
    );
  });
  it('isolates owners and rejects malformed or ownership-injecting request bodies', async () => {
    await seed();
    const q = (await quote('USDC', '10000000')).body;
    const o = (await order(q.id)).body;
    expect(
      (
        await http()
          .get('/fiat/unified')
          .set('x-test-consumer', 'bob')
          .expect(200)
      ).body.total.totalMinor,
    ).toBe('0');
    await http()
      .post('/fiat/unified/orders')
      .set('x-test-consumer', 'bob')
      .send({ quoteId: q.id, idempotencyKey: 'other-consumer-001' })
      .expect(404);
    await http()
      .post(`/fiat/unified/orders/${o.id}/advance`)
      .set('x-test-consumer', 'bob')
      .send({ action: 'advance', idempotencyKey: 'other-consumer-002' })
      .expect(404);
    for (const extra of [
      { amountMinor: '-1' },
      { ownerId: 'bob' },
      { mode: 'production' },
    ]) {
      await http()
        .post('/fiat/unified/receive')
        .send({
          currency: 'NGN',
          amountMinor: '1',
          idempotencyKey: 'invalid-credit-001',
          ...extra,
        })
        .expect(400);
    }
    await http().get('/fiat/unified?displayCurrency=USDC').expect(400);
    await http()
      .post('/fiat/unified/quotes')
      .send({
        destinationCurrency: 'USDC',
        recipientMinor: '1',
        sendAll: true,
        destination: 'address',
      })
      .expect(400);
  });
  it('advances a persisted automatic order with idempotent concurrent worker ticks', async () => {
    await seed();
    const q = (await quote('USDC', undefined, true)).body;
    const o = (
      await http()
        .post('/fiat/unified/orders')
        .send({
          quoteId: q.id,
          idempotencyKey: 'automatic-order-001',
          autoAdvance: true,
        })
        .expect(201)
    ).body;
    await app.close();
    await start();
    const service = app.get(UnifiedFiatService);
    for (let i = 0; i < 4; i++)
      await Promise.all([service.tickAuto(), service.tickAuto()]);
    const final = (await snapshot()).body;
    expect(
      (final.orders as { id: string; status: string }[]).find(
        (item) => item.id === o.id,
      )?.status,
    ).toBe('completed');
    expect(final.total.totalMinor).toBe('0');
    expect(final.holdings.NGN.reservedMinor).toBe('0');
    expect(final.holdings.USDC.reservedMinor).toBe('0');
  });
  it('does not let a stale worker advance past a manual transition', async () => {
    await seed();
    const q = (await quote('USDC', undefined, true)).body;
    const o = (await order(q.id)).body;
    await advance(o.id, 'manual-convert-001');
    await expect(
      app
        .get(UnifiedFiatService)
        .advance(
          'alice',
          o.id,
          { action: 'advance', idempotencyKey: 'stale-convert-001' },
          'converting',
        ),
    ).rejects.toThrow('Order already advanced');
    expect((await snapshot()).body.orders[0].status).toBe('ready_to_send');
    expect((await snapshot()).body.holdings.USDC.settledMinor).toBe(
      '400000000',
    );
  });
  it('fails closed when simulation is disabled or the server is production', async () => {
    enabled = '';
    await http().get('/fiat/unified').expect(503);
    enabled = 'true';
    environment = 'production';
    await http()
      .post('/fiat/unified/receive')
      .send({
        currency: 'NGN',
        amountMinor: '1',
        idempotencyKey: 'production-001',
      })
      .expect(503);
    expect(
      (await pool.query('SELECT count(*) FROM fiat_unified_wallets')).rows[0]
        .count,
    ).toBe('0');
  });
});
