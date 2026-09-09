/** Real HTTP + PostgreSQL; provider boundary is a test double, not proof of sandbox settlement. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
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
import { BankingRegistry } from './banking.registry';
import { NairaAccountsService } from './accounts.service';
import { NairaAccountsController } from './accounts.controller';
import type { BankAccountProvider } from './banking-provider.interface';

const describePg = process.env.FIAT_PG_TEST_DATABASE_URL
  ? describe
  : describe.skip;
describePg('per-user naira accounts HTTP + PostgreSQL', () => {
  const namespace = `bank_accounts_${randomBytes(6).toString('hex')}`;
  let admin: Pool;
  let pool: Pool;
  let app: INestApplication;
  let environment = 'test';
  let selected = 'paga';
  let ready = true;
  const createAccount = jest.fn<
    ReturnType<BankAccountProvider['createAccount']>,
    Parameters<BankAccountProvider['createAccount']>
  >();
  async function start() {
    const module = await Test.createTestingModule({
      controllers: [NairaAccountsController],
      providers: [
        NairaAccountsService,
        { provide: DbService, useValue: { client: drizzle(pool, { schema }) } },
        {
          provide: BankingRegistry,
          useValue: {
            accountProvisioningReady: () => ready,
            get: () => ({ createAccount }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({
                NODE_ENV: environment,
                FIAT_NGN_ACCOUNT_PROVIDER: selected,
              })[key],
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
      readFileSync('drizzle/0043_bank_accounts.sql', 'utf8').replaceAll(
        '"public".',
        `"${namespace}".`,
      ),
    );
    await pool.query(
      readFileSync('drizzle/0044_bank_account_uniqueness.sql', 'utf8'),
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
    await pool.query('DELETE FROM fiat_bank_accounts');
    environment = 'test';
    selected = 'paga';
    ready = true;
    createAccount.mockReset().mockImplementation((input) =>
      Promise.resolve({
        provider: selected,
        reference: input.accountReference,
        currency: 'NGN',
        custody: 'pooled',
        bankName: 'Test bank',
        accountNumber: (
          BigInt(`0x${input.accountReference.slice(3)}`) % 10000000000n
        )
          .toString()
          .padStart(10, '0'),
        accountName: 'Alice Example',
      }),
    );
  });
  const http = () => request(app.getHttpServer() as Server);
  const path = '/fiat/banking/accounts';
  const body = {
    firstName: 'Alice',
    lastName: 'Example',
    email: 'alice@example.test',
  };
  const create = (owner = 'alice') =>
    http().post(path).set('x-test-consumer', owner).send(body).expect(201);

  it('persists provider coordinates across restart without persisting identity submission', async () => {
    const created = (await create()).body;
    expect(created).toMatchObject({
      status: 'active',
      environment: 'sandbox',
      account: { accountNumber: expect.stringMatching(/^\d{10}$/) },
    });
    await app.close();
    await start();
    expect((await http().get(path).expect(200)).body.accounts).toEqual([
      created,
    ]);
    const records = await pool.query('SELECT * FROM fiat_bank_accounts');
    expect(JSON.stringify(records.rows)).not.toContain(body.email);
    expect((await create()).body.id).toBe(created.id);
    expect(createAccount).toHaveBeenCalledTimes(1);
  });
  it('claims before submission and prevents concurrent duplicate account creates', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const implementation = createAccount.getMockImplementation()!;
    createAccount.mockImplementation(async (input) => {
      await barrier;
      return implementation(input);
    });
    const first = create().then((response) => response);
    while (!createAccount.mock.calls.length)
      await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      const second = await create();
      expect(second.body.status).toBe('creating');
      expect(createAccount).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
    expect((await first).body.status).toBe('active');
  });
  it('retains an uncertain claim and never auto-resubmits after restart', async () => {
    createAccount.mockRejectedValue(new Error('timeout with secret response'));
    const failed = (await create()).body;
    expect(failed.status).toBe('needs_attention');
    expect(failed.account).toBeNull();
    await app.close();
    await start();
    expect((await create()).body.id).toBe(failed.id);
    expect(createAccount).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(
        (await pool.query('SELECT * FROM fiat_bank_accounts')).rows,
      ),
    ).not.toContain('secret');
  });
  it('marks abandoned claims for attention without losing their provider reference', async () => {
    const created = (await create()).body;
    await pool.query(
      "UPDATE fiat_bank_accounts SET status = 'creating', account = NULL, created_at = now() - interval '3 minutes'",
    );
    const accounts = (await http().get(path).expect(200)).body.accounts;
    expect(accounts[0]).toMatchObject({
      id: created.id,
      status: 'needs_attention',
    });
    await create();
    expect(createAccount).toHaveBeenCalledTimes(1);
  });
  it('isolates owners and permits separate accounts for each configured provider', async () => {
    await create();
    expect(
      (await http().get(path).set('x-test-consumer', 'bob').expect(200)).body
        .accounts,
    ).toEqual([]);
    await create('bob');
    selected = 'nomba';
    await create();
    expect((await http().get(path).expect(200)).body.accounts).toHaveLength(2);
    expect(createAccount).toHaveBeenCalledTimes(3);
  });
  it('rejects mismatched provider coordinates without crediting an account', async () => {
    createAccount.mockResolvedValue({
      provider: 'paga',
      reference: 'wrong',
      accountNumber: '0123456789',
      accountName: 'Alice',
      bankName: 'Paga',
      currency: 'NGN',
      custody: 'pooled',
    });
    expect((await create()).body.status).toBe('needs_attention');
  });
  it('does not activate the same external account for two users', async () => {
    const implementation = createAccount.getMockImplementation()!;
    createAccount.mockImplementation(async (input) => ({
      ...(await implementation(input)),
      accountNumber: '0123456789',
    }));
    const responses = await Promise.all([create('alice'), create('bob')]);
    expect(
      responses.map((response) => String(response.body.status)).sort(),
    ).toEqual(['active', 'needs_attention']);
    expect(
      (
        await pool.query(
          "SELECT * FROM fiat_bank_accounts WHERE status = 'active'",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it('fails closed for anonymous fixtures, missing configuration and production', async () => {
    ready = false;
    expect((await http().get(path).expect(200)).body.available).toBe(false);
    await http().post(path).send(body).expect(503);
    ready = true;
    selected = '';
    await http().post(path).send(body).expect(503);
    selected = 'paga';
    environment = 'production';
    await http().post(path).send(body).expect(503);
    expect(createAccount).not.toHaveBeenCalled();
    expect((await pool.query('SELECT * FROM fiat_bank_accounts')).rows).toEqual(
      [],
    );
  });
  it('validates identity fields without implying optional BVN waives provider KYC', async () => {
    await http()
      .post(path)
      .send({ ...body, bvn: '123' })
      .expect(400);
    await http()
      .post(path)
      .send({ ...body, provider: 'nomba' })
      .expect(400);
    await http()
      .post(path)
      .send({ ...body, email: 'invalid' })
      .expect(400);
    await http()
      .post(path)
      .send({ ...body, bvn: '12345678901' })
      .expect(201);
    expect(createAccount.mock.calls[0][0].bvn).toBe('12345678901');
    expect(
      JSON.stringify(
        (await pool.query('SELECT * FROM fiat_bank_accounts')).rows,
      ),
    ).not.toContain('12345678901');
  });
});
