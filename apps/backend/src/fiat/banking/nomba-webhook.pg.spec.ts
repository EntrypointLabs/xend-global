import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readFileSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import request from 'supertest';
import { DbService } from '../../db/db.service';
import { BankingRegistry } from './banking.registry';
import { BankNotificationInbox } from './notification-inbox';
import { NombaWebhookController } from './nomba-webhook.controller';

const describePg = process.env.FIAT_PG_TEST_DATABASE_URL
  ? describe
  : describe.skip;
describePg('Nomba notification HTTP + PostgreSQL', () => {
  const namespace = `nomba_hooks_${randomBytes(6).toString('hex')}`;
  const secret = 'test-only-webhook-secret';
  let admin: Pool, pool: Pool, app: INestApplication;
  const config: Record<string, string> = {};
  let ready = true;
  async function start() {
    const module = await Test.createTestingModule({
      controllers: [NombaWebhookController],
      providers: [
        BankNotificationInbox,
        { provide: DbService, useValue: { client: drizzle(pool) } },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
        {
          provide: BankingRegistry,
          useValue: { accountProvisioningReady: () => ready },
        },
      ],
    }).compile();
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
    });
    await pool.query(
      readFileSync('drizzle/0046_bank_notifications.sql', 'utf8'),
    );
    await start();
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
      await admin.end();
    }
  });
  beforeEach(async () => {
    Object.assign(config, {
      NODE_ENV: 'test',
      NOMBA_SANDBOX_ACCOUNT_ID: 'owned-parent',
      NOMBA_SANDBOX_WEBHOOK_SECRET: secret,
    });
    ready = true;
    await pool.query('DELETE FROM fiat_bank_notifications');
  });
  function payload() {
    return {
      event_type: 'payment_success',
      requestId: 'delivery-1',
      data: {
        merchant: {
          userId: 'owned-parent',
          walletId: 'owned-wallet',
          walletBalance: 99999,
        },
        transaction: {
          transactionId: 'deposit-1',
          type: 'vact_transfer',
          time: new Date().toISOString(),
          responseCode: '',
          transactionAmount: 100,
          aliasAccountNumber: '0123456789',
          aliasAccountReference: 'unsigned-reference',
        },
      },
    };
  }
  function signed(
    body: ReturnType<typeof payload>,
    timestamp = new Date().toISOString(),
  ) {
    const t = body.data.transaction,
      m = body.data.merchant;
    const message = [
      body.event_type,
      body.requestId,
      m.userId,
      m.walletId,
      t.transactionId,
      t.type,
      t.time,
      t.responseCode,
      timestamp,
    ].join(':');
    return {
      'nomba-signature': createHmac('sha256', secret)
        .update(message)
        .digest('base64'),
      'nomba-signature-algorithm': 'HmacSHA256',
      'nomba-signature-version': '1.0.0',
      'nomba-timestamp': timestamp,
    };
  }
  const post = (body: ReturnType<typeof payload>, headers = signed(body)) =>
    request(app.getHttpServer() as Server)
      .post('/webhooks/nomba/sandbox')
      .set(headers)
      .send(body);
  it('persists only signed identities across restart and deduplicates concurrent delivery', async () => {
    const body = payload();
    const results = await Promise.all([post(body), post(body)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results.map((r) => r.body as unknown)).toEqual(
      expect.arrayContaining([
        { accepted: true, duplicate: false },
        { accepted: true, duplicate: true },
      ]),
    );
    await app.close();
    await start();
    expect((await post(body).expect(200)).body).toMatchObject({
      duplicate: true,
    });
    const rows = await pool.query<{
      status: string;
      notification: { transactionId: string };
    }>('SELECT * FROM fiat_bank_notifications');
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].status).toBe('received');
    expect(rows.rows[0].notification.transactionId).toBe('deposit-1');
    const encoded = JSON.stringify(rows.rows);
    expect(encoded).not.toContain('transactionAmount');
    expect(encoded).not.toContain('0123456789');
    expect(encoded).not.toContain('walletBalance');
    expect(encoded).not.toContain('unsigned-reference');
  });
  it('ignores unsigned amount/recipient tampering instead of creating a new credit', async () => {
    const body = payload(),
      headers = signed(body);
    await post(body, headers).expect(200);
    body.data.transaction.transactionAmount = 1000000;
    body.data.transaction.aliasAccountNumber = '9999999999';
    expect((await post(body, headers).expect(200)).body).toMatchObject({
      duplicate: true,
    });
    expect(
      (
        await pool.query<{ count: string }>(
          'SELECT count(*) FROM fiat_bank_notifications',
        )
      ).rows[0].count,
    ).toBe('1');
  });
  it('refuses a reused event ID carrying a changed signed transaction identity', async () => {
    const body = payload();
    await post(body).expect(200);
    body.data.transaction.transactionId = 'deposit-2';
    await post(body).expect(409);
  });
  it('rejects invalid or stale signatures and wrong merchant before persistence', async () => {
    const body = payload();
    await post(body, { ...signed(body), 'nomba-signature': 'invalid' }).expect(
      401,
    );
    await post(
      body,
      signed(body, new Date(Date.now() - 600000).toISOString()),
    ).expect(401);
    body.data.merchant.userId = 'different-parent';
    await post(body).expect(401);
    expect(
      (
        await pool.query<{ count: string }>(
          'SELECT count(*) FROM fiat_bank_notifications',
        )
      ).rows[0].count,
    ).toBe('0');
  });
  it.each(['production', 'missing-secret', 'disabled-provider'])(
    'disables the receiver for %s',
    async (mode) => {
      if (mode === 'production') config.NODE_ENV = 'production';
      if (mode === 'missing-secret') config.NOMBA_SANDBOX_WEBHOOK_SECRET = '';
      if (mode === 'disabled-provider') ready = false;
      await post(payload()).expect(503);
    },
  );
  it('acknowledges unsupported signed events without persisting them', async () => {
    const body = payload();
    body.event_type = 'new_event';
    expect((await post(body).expect(200)).body).toMatchObject({
      ignored: true,
    });
    expect(
      (
        await pool.query<{ count: string }>(
          'SELECT count(*) FROM fiat_bank_notifications',
        )
      ).rows[0].count,
    ).toBe('0');
  });
});
