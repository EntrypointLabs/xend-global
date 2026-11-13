/** Opt-in HTTP + actual PostgreSQL ownership checks; remote providers are fixtures. */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { DbService } from '../../db/db.service';
import { ConsumerAuthGuard } from '../../auth/consumer-auth.guard';
import { SOLANA_RPC } from '../../solana/solana-rpc.interface';
import { BankingRegistry } from '../banking/banking.registry';
import { ObservedBalancesService } from './observed-balances.service';
import type { ObservedBalances } from './observed-balances.types';
import { ObservedBalancesController } from './observed-balances.controller';

const describePg = process.env.FIAT_PG_TEST_DATABASE_URL
  ? describe
  : describe.skip;
const mint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const aliceVault = '11111111111111111111111111111111';
const bobVault = 'So11111111111111111111111111111111111111112';

describePg('observed balances HTTP + PostgreSQL', () => {
  const namespace = `observed_test_${randomBytes(6).toString('hex')}`;
  let admin: Pool;
  let pool: Pool;
  let app: INestApplication;
  const bankReads: string[] = [];
  const chainReads: string[] = [];
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
      'CREATE TABLE fiat_bank_accounts (owner_id text, provider text, environment text, status text, account_reference text, account jsonb)',
    );
    await pool.query(
      'CREATE TABLE squads_accounts (user_id text, vault_address text)',
    );
    for (const owner of ['alice', 'bob']) {
      const reference = `xna${owner}0123456789`;
      await pool.query(
        'INSERT INTO fiat_bank_accounts VALUES ($1, $2, $3, $4, $5, $6)',
        [
          owner,
          'paga',
          'sandbox',
          'active',
          reference,
          { provider: 'paga', currency: 'NGN', reference },
        ],
      );
      await pool.query('INSERT INTO squads_accounts VALUES ($1,$2)', [
        owner,
        owner === 'alice' ? aliceVault : bobVault,
      ]);
    }
    const module = await Test.createTestingModule({
      controllers: [ObservedBalancesController],
      providers: [
        ObservedBalancesService,
        { provide: DbService, useValue: { client: drizzle(pool) } },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            SOLANA_CLUSTER: 'devnet',
            EXPO_PUBLIC_USDC_MINT_ADDRESS: mint,
            HELIUS_RPC_URL: 'https://devnet.helius-rpc.com',
            SOLANA_PUBLIC_RPC_URL: 'https://api.devnet.solana.com',
            FIAT_NGN_ACCOUNT_PROVIDER: 'paga',
          }),
        },
        {
          provide: BankingRegistry,
          useValue: {
            usdValuationReader: () => null,
            balanceReader: () => ({
              getBalance: (reference: string) => {
                bankReads.push(reference);
                return Promise.resolve({
                  amountMinor: reference.includes('alice') ? '12300' : '56700',
                  currency: 'NGN',
                  observedAt: new Date().toISOString(),
                });
              },
            }),
          },
        },
        {
          provide: SOLANA_RPC,
          useValue: {
            getTokenBalances: (address: string) => {
              chainReads.push(address);
              return Promise.resolve([
                {
                  mint,
                  decimals: 6,
                  amountRaw: address === aliceVault ? 42000000n : 98000000n,
                },
              ]);
            },
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
          if (!req.headers['x-test-consumer'])
            throw new UnauthorizedException();
          req.user = { userId: req.headers['x-test-consumer'] };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
      await admin.end();
    }
  });
  it('uses authenticated ownership through SQL and both provider reads despite client address overrides', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get(
        `/fiat/balances?ownerId=bob&vaultAddress=${bobVault}&accountReference=xnabob0123456789`,
      )
      .set('x-test-consumer', 'alice')
      .expect(200);
    expect(
      (response.body as ObservedBalances).holdings.map(
        (holding) => holding.amountMinor,
      ),
    ).toEqual(['12300', '42000000']);
    expect(bankReads).toEqual(['xnaalice0123456789']);
    expect(chainReads).toEqual([aliceVault]);
    expect(response.body.total).toBeNull();
    expect(response.body.mode).toBe('observed');
  });
  it('isolates the second owner and keeps unknown owners unavailable', async () => {
    const bob = await request(app.getHttpServer() as Server)
      .get('/fiat/balances')
      .set('x-test-consumer', 'bob')
      .expect(200);
    expect(
      (bob.body as ObservedBalances).holdings.map(
        (holding) => holding.amountMinor,
      ),
    ).toEqual(['56700', '98000000']);
    const missing = await request(app.getHttpServer() as Server)
      .get('/fiat/balances')
      .set('x-test-consumer', 'missing')
      .expect(200);
    expect(
      (missing.body as ObservedBalances).holdings.map(
        (holding) => holding.amountMinor,
      ),
    ).toEqual([null, null]);
    expect(bankReads).toHaveLength(2);
    expect(chainReads).toHaveLength(2);
  });
  it('requires an authenticated identity', async () => {
    await request(app.getHttpServer() as Server)
      .get('/fiat/balances')
      .expect(401);
    expect(bankReads).toHaveLength(2);
    expect(chainReads).toHaveLength(2);
  });
});
