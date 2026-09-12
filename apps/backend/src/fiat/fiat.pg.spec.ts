/** Opt-in integration test; creates/drops only its own isolated test schema. */
// Supertest response bodies are intentionally asserted at the HTTP boundary.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import type { INestApplication, ExecutionContext } from '@nestjs/common';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { DbModule } from '../db/db.module';
import { DbService } from '../db/db.service';
import { ConsumerAuthGuard } from '../auth/consumer-auth.guard';
import { FiatModule } from './fiat.module';
import { SolanaModule } from '../solana/solana.module';
import { SOLANA_RPC } from '../solana/solana-rpc.interface';
import * as schema from '../db/schema';

const describePg = process.env.FIAT_PG_TEST_DATABASE_URL
  ? describe
  : describe.skip;
describePg('fiat HTTP + PostgreSQL', () => {
  const namespace = `fiat_test_${randomBytes(6).toString('hex')}`;
  let admin: Pool;
  let pool: Pool;
  let app: INestApplication;
  async function start() {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({ NODE_ENV: 'test', FIAT_ENABLED_PROVIDERS: 'simulator' }),
          ],
        }),
        DbModule,
        FiatModule,
      ],
    })
      .overrideModule(SolanaModule)
      .useModule({
        module: class TestSolanaModule {},
        providers: [{ provide: SOLANA_RPC, useValue: {} }],
        exports: [SOLANA_RPC],
      })
      .overrideProvider(DbService)
      .useValue({ client: drizzle(pool, { schema }) })
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
      max: 4,
    });
    await pool.query('CREATE TABLE users (id text PRIMARY KEY)');
    const migration = readFileSync(
      'drizzle/0041_consumer_fiat_orders.sql',
      'utf8',
    ).replaceAll('"public".', `"${namespace}".`);
    await pool.query(migration);
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
  it('serves exact quotes, rejects duplicates/conflicts and persists across application restart', async () => {
    const http = () => request(app.getHttpServer() as Server);
    const routes = await http().get('/fiat/routes').expect(200);
    expect(routes.body.routes).toHaveLength(2);
    const quote = (
      await http()
        .post('/fiat/quotes')
        .send({ routeId: 'simulator:receive', amountMinor: '150000' })
        .expect(201)
    ).body;
    expect(quote.credit.amountMinor).toBe('1000000');
    const body = {
      quoteId: quote.id,
      idempotencyKey: 'parallel-order-1',
      fields: {},
    };
    const responses = await Promise.all([
      http().post('/fiat/orders').send(body),
      http().post('/fiat/orders').send(body),
    ]);
    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(responses[0].body.id).toBe(responses[1].body.id);
    const id = responses[0].body.id;
    expect(
      (await pool.query('SELECT count(*) FROM fiat_orders')).rows[0].count,
    ).toBe('1');
    await http()
      .post('/fiat/orders')
      .send({ ...body, fields: { changed: 'value' } })
      .expect(409);
    await http()
      .post('/fiat/orders')
      .send({ ...body, idempotencyKey: 'another-request-key' })
      .expect(409);
    await http()
      .get(`/fiat/orders/${id}`)
      .set('x-test-consumer', 'bob')
      .expect(404);
    await http()
      .post('/fiat/orders')
      .set('x-test-consumer', 'bob')
      .send(body)
      .expect(404);
    const update = {
      event: 'payment_received',
      idempotencyKey: 'same-payment-event',
    };
    const updates = await Promise.all([
      http().post(`/fiat/orders/${id}/simulate`).send(update),
      http().post(`/fiat/orders/${id}/simulate`).send(update),
    ]);
    expect(
      updates.every((r) => r.status === 201 && r.body.status === 'processing'),
    ).toBe(true);
    expect(
      (await pool.query('SELECT count(*) FROM fiat_order_events')).rows[0]
        .count,
    ).toBe('1');
    await http()
      .post(`/fiat/orders/${id}/simulate`)
      .send({ ...update, event: 'complete' })
      .expect(409);
    await app.close();
    await start();
    expect(
      (await http().get(`/fiat/orders/${id}`).expect(200)).body.status,
    ).toBe('processing');
    expect(
      (
        await http()
          .post(`/fiat/orders/${id}/simulate`)
          .send({ event: 'fail', idempotencyKey: 'payout-failure-1' })
          .expect(201)
      ).body.status,
    ).toBe('return_pending');
    expect(
      (
        await http()
          .post(`/fiat/orders/${id}/simulate`)
          .send({ event: 'return', idempotencyKey: 'return-confirmed-1' })
          .expect(201)
      ).body.status,
    ).toBe('returned');
    await http()
      .post(`/fiat/orders/${id}/simulate`)
      .send({ event: 'complete', idempotencyKey: 'late-completion-1' })
      .expect(409);
  });
});
