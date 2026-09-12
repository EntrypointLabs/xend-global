/** Real HTTP/PostgreSQL, mocked Paga transport methods; not funded sandbox evidence. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication, ExecutionContext } from '@nestjs/common';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { DbService } from '../../db/db.service';
import { ConsumerAuthGuard } from '../../auth/consumer-auth.guard';
import * as schema from '../../db/schema';
import { BankingRegistry } from './banking.registry';
import { NairaTransfersService } from './transfers.service';
import type { NairaTransferRecord } from './transfers.types';
import { NairaTransfersController } from './transfers.controller';
import { PagaProvider } from './paga.provider';
const describePg = process.env.FIAT_PG_TEST_DATABASE_URL
  ? describe
  : describe.skip;
describePg('Paga account transfers HTTP + PostgreSQL', () => {
  const namespace = `bank_transfers_${randomBytes(6).toString('hex')}`;
  const provider = new PagaProvider({
    environment: 'sandbox',
    publicKey: 'test',
    secretKey: 'test',
    hashKey: 'test',
  });
  const retrieve = jest.spyOn(provider, 'retrieveAccount');
  const balance = jest.spyOn(provider, 'getBalance');
  const transfer = jest.spyOn(provider, 'transferSubsidiary');
  let admin: Pool;
  let pool: Pool;
  let app: INestApplication;
  let environment = 'test';
  let ready = true;
  async function start() {
    const module = await Test.createTestingModule({
      controllers: [NairaTransfersController],
      providers: [
        NairaTransfersService,
        { provide: DbService, useValue: { client: drizzle(pool, { schema }) } },
        {
          provide: BankingRegistry,
          useValue: {
            accountProvisioningReady: () => ready,
            get: () => provider,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({ NODE_ENV: environment, FIAT_NGN_ACCOUNT_PROVIDER: 'paga' })[
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
    for (const file of [
      '0043_bank_accounts',
      '0044_bank_account_uniqueness',
      '0045_bank_transfers',
    ])
      await pool.query(
        readFileSync(`drizzle/${file}.sql`, 'utf8').replaceAll(
          '"public".',
          `"${namespace}".`,
        ),
      );
    await pool.query(
      "INSERT INTO users (id) VALUES ('alice'), ('bob'), ('charlie')",
    );
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
    await pool.query('DELETE FROM fiat_bank_transfers');
    await pool.query('DELETE FROM fiat_bank_accounts');
    for (const [owner, number] of [
      ['alice', '1234567890'],
      ['bob', '0987654321'],
    ])
      await pool.query(
        `INSERT INTO fiat_bank_accounts (id, owner_id, provider, environment, status, account_reference, account)
        VALUES ($1, $1, 'paga', 'sandbox', 'active', $1, $2::jsonb)`,
        [
          owner,
          JSON.stringify({
            provider: 'paga',
            reference: owner,
            accountNumber: number,
            accountName: owner,
            currency: 'NGN',
            bankName: 'Paga',
            custody: 'pooled',
          }),
        ],
      );
    environment = 'test';
    ready = true;
    retrieve.mockReset().mockResolvedValue({
      accountNumber: '0987654321',
      accountReference: 'bob',
      accountName: 'Bob Provider',
      balanceMinor: '0',
    });
    balance.mockReset().mockImplementation(() =>
      Promise.resolve({
        amountMinor: '100000',
        currency: 'NGN',
        observedAt: new Date().toISOString(),
      }),
    );
    transfer.mockReset().mockResolvedValue({
      providerReference: 'paga-transfer-1',
      sourceBalanceMinor: '99000',
      destinationBalanceMinor: '1000',
      evidence: 'sandbox_response',
    });
  });
  const http = () => request(app.getHttpServer() as Server);
  const path = '/fiat/banking/transfers';
  const quote = () =>
    http()
      .post(`${path}/quotes`)
      .send({ destinationAccountNumber: '0987654321', amountMinor: '1000' })
      .expect(201);
  const send = (quoteId: string, idempotencyKey = 'test-transfer-key') =>
    http().post(path).send({ quoteId, idempotencyKey });
  it('verifies recipient, uses owned source, persists exact completion across restart', async () => {
    const q = (await quote()).body as NairaTransferRecord;
    expect(q).toMatchObject({
      status: 'quoted',
      amountMinor: '1000',
      feeMinor: null,
      destination: { accountName: 'Bob Provider' },
    });
    const sent = (await send(q.id).expect(201)).body;
    expect(sent).toMatchObject({
      status: 'completed',
      providerReference: 'paga-transfer-1',
    });
    expect(transfer).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: q.id,
        sourceAccountIdentifier: '1234567890',
        destinationAccountIdentifier: '0987654321',
        amountMinor: '1000',
      }),
    );
    await app.close();
    await start();
    expect((await http().get(path).expect(200)).body.transfers[0]).toEqual(
      sent,
    );
    await send(q.id).expect(201);
    expect(transfer).toHaveBeenCalledTimes(1);
  });
  it('serializes duplicate confirmations and does not submit a quote under a second key', async () => {
    const q = (await quote()).body as NairaTransferRecord;
    await Promise.all([send(q.id).expect(201), send(q.id).expect(201)]);
    await send(q.id, 'different-key').expect(409);
    expect(transfer).toHaveBeenCalledTimes(1);
  });
  it('blocks unknown transfers from replay and future outgoing sends', async () => {
    transfer.mockRejectedValueOnce(new Error('timeout'));
    const q = (await quote()).body as NairaTransferRecord;
    expect((await send(q.id).expect(201)).body.status).toBe('needs_attention');
    await send(q.id).expect(201);
    const next = (await quote()).body as NairaTransferRecord;
    await send(next.id, 'next-transfer-key').expect(409);
    expect(transfer).toHaveBeenCalledTimes(1);
  });
  it('rejects insufficient and stale provider balances without submitting', async () => {
    const q = (await quote()).body as NairaTransferRecord;
    balance.mockResolvedValueOnce({
      amountMinor: '999',
      currency: 'NGN',
      observedAt: new Date().toISOString(),
    });
    await send(q.id).expect(409);
    balance.mockResolvedValueOnce({
      amountMinor: '100000',
      currency: 'NGN',
      observedAt: new Date(Date.now() - 120000).toISOString(),
    });
    await send(q.id).expect(503);
    expect(transfer).not.toHaveBeenCalled();
  });
  it('enforces owner isolation, recipient verification, active accounts and strict DTOs', async () => {
    const q = (await quote()).body as NairaTransferRecord;
    await http()
      .post(path)
      .set('x-test-consumer', 'bob')
      .send({ quoteId: q.id, idempotencyKey: 'bob-send-key' })
      .expect(404);
    expect(
      (await http().get(path).set('x-test-consumer', 'bob').expect(200)).body
        .transfers,
    ).toEqual([]);
    await http()
      .post(`${path}/quotes`)
      .send({ destinationAccountNumber: '1234567890', amountMinor: '1' })
      .expect(404);
    await http()
      .post(`${path}/quotes`)
      .send({
        destinationAccountNumber: '0987654321',
        amountMinor: '1',
        sourceAccountNumber: '0987654321',
      })
      .expect(400);
    retrieve.mockResolvedValueOnce({
      accountNumber: '0987654321',
      accountReference: 'wrong',
      accountName: 'Wrong',
      balanceMinor: '0',
    });
    await http()
      .post(`${path}/quotes`)
      .send({ destinationAccountNumber: '0987654321', amountMinor: '1' })
      .expect(503);
    await pool.query(
      "UPDATE fiat_bank_accounts SET status = 'needs_attention' WHERE id = 'bob'",
    );
    await send(q.id).expect(409);
    expect(transfer).not.toHaveBeenCalled();
  });
  it('blocks production/uncredentialed execution and expired quotes', async () => {
    const q = (await quote()).body as NairaTransferRecord;
    await pool.query(
      "UPDATE fiat_bank_transfers SET record = jsonb_set(record, '{expiresAt}', to_jsonb((now() - interval '1 minute')::text))",
    );
    await send(q.id).expect(409);
    environment = 'production';
    await send(q.id).expect(503);
    environment = 'test';
    ready = false;
    await send(q.id).expect(503);
    expect(transfer).not.toHaveBeenCalled();
  });
  it('rejects idempotency payload reuse and never retries a crashed submitting claim', async () => {
    const first = (await quote()).body as NairaTransferRecord;
    await send(first.id).expect(201);
    const second = (await quote()).body as NairaTransferRecord;
    await send(second.id).expect(409);
    await pool.query(
      `UPDATE fiat_bank_transfers SET record = jsonb_set(jsonb_set(record, '{status}', '"submitting"'::jsonb), '{updatedAt}', to_jsonb((now() - interval '3 minutes')::text)) WHERE id = $1`,
      [first.id],
    );
    const state = (await http().get(path).expect(200)).body
      .transfers as NairaTransferRecord[];
    expect(state.find((row) => row.id === first.id)?.status).toBe(
      'needs_attention',
    );
    await send(first.id).expect(201);
    expect(transfer).toHaveBeenCalledTimes(1);
    await http()
      .post(path)
      .send({ quoteId: randomUUID(), idempotencyKey: 'missing-quote' })
      .expect(404);
  });
});
