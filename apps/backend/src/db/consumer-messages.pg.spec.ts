/** Opt-in real PostgreSQL checks; only this test's random schema is touched. */
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Keypair } from '@solana/web3.js';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { FeedbackRateLimitedError } from '../feedback/feedback.errors';
import { FeedbackService } from '../feedback/feedback.service';
import { DrizzleFeedbackStore } from '../feedback/feedback.store';
import type { Mailer } from '../mail/mail.interface';
import type { TokenPriceProvider } from '../prices/token-price.interface';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import { DrizzleSupportRequestStore } from '../support/support-request.store';
import { SupportRateLimitedError } from '../support/support.errors';
import { SupportService } from '../support/support.service';
import type { TokenMetadataProvider } from '../tokens/token-metadata.interface';
import { WalletsService } from '../wallets/wallets.service';
import { DbService } from './db.service';
import {
  feedback,
  smartAccounts,
  squadsAccounts,
  supportRequests,
  users,
} from './schema';

const DATABASE_URL = process.env.CONSUMER_PG_TEST_DATABASE_URL;
const describePg = DATABASE_URL ? describe : describe.skip;

const DRIZZLE = join(__dirname, '..', '..', 'drizzle');

const CHECK_VIOLATION = '23514';

const T0 = new Date('2027-03-01T09:00:00.000Z');
const MINUTE = 60_000;
const after = (ms: number) => new Date(T0.getTime() + ms);
const address = () => Keypair.generate().publicKey.toBase58();

/** The SQLSTATE a statement was refused with, wherever the driver put it. */
async function sqlState(statement: Promise<unknown>): Promise<string | null> {
  try {
    await statement;
    return null;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code ?? 'unknown';
  }
}

describePg('What a Consumer sends the team, on PostgreSQL', () => {
  const namespace = `consumer_messages_test_${randomBytes(6).toString('hex')}`;
  let admin: Pool;
  let db: DbService;
  let nextConsumer = 0;

  beforeAll(async () => {
    admin = new Pool({ connectionString: DATABASE_URL });
    await admin.query(`CREATE SCHEMA "${namespace}"`);

    // The real schema, built the way a deployment builds it: every journalled
    // migration in order, pointed at this test's schema.
    const scoped = new URL(DATABASE_URL!);
    scoped.searchParams.set('options', `-c search_path=${namespace}`);
    const migrate = new Pool({ connectionString: scoped.toString(), max: 1 });
    const journal = JSON.parse(
      readFileSync(join(DRIZZLE, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: { tag: string }[] };
    for (const { tag } of journal.entries) {
      const migration = readFileSync(join(DRIZZLE, `${tag}.sql`), 'utf8');
      for (const statement of migration
        .replaceAll('"public".', `"${namespace}".`)
        .split('--> statement-breakpoint')) {
        if (statement.trim() !== '') await migrate.query(statement);
      }
    }
    await migrate.end();

    db = new DbService({
      getOrThrow: () => scoped.toString(),
      get: () => undefined,
    } as unknown as ConfigService);
    await db.onModuleInit();

    // Open the connections the tests below race on. Left to open on demand,
    // the first racer finishes while the others are still connecting, and a
    // race that never overlaps proves nothing about the locking.
    await Promise.all(Array.from({ length: 8 }, () => db.ping()));
  }, 60_000);

  afterAll(async () => {
    await db?.onModuleDestroy();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
      await admin.end();
    }
  });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  /** A Consumer nobody else in this file touches, with an Account row. */
  async function consumer(
    opts: { email?: string | null; vault?: boolean } = {},
  ): Promise<{ id: string; wallet: string; vault: string | null }> {
    nextConsumer += 1;
    const id = `consumer_${nextConsumer}`;
    const wallet = address();
    await db.client.insert(users).values({
      id,
      email: opts.email === undefined ? `${id}@example.com` : opts.email,
    });
    await db.client.insert(smartAccounts).values({
      id: `sa_${id}`,
      userId: id,
      walletAddress: wallet,
      providerUserId: `did:privy:${id}`,
    });
    const vault = opts.vault ? address() : null;
    if (vault) {
      await db.client.insert(squadsAccounts).values({
        userId: id,
        settingsSeed: BigInt(nextConsumer),
        settingsAddress: address(),
        vaultAddress: vault,
        primarySigner: wallet,
        approvalSigner: address(),
        approvalSubOrgId: `sub_${id}`,
      });
    }
    return { id, wallet, vault };
  }

  const rejections = (settled: PromiseSettledResult<unknown>[]) =>
    settled
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason as unknown);

  const store = () => new DrizzleSupportRequestStore(db);
  const service = (send: Mailer['send'] = () => Promise.resolve()) =>
    new SupportService(
      { get: () => 'support@prydd.test' } as unknown as ConfigService,
      store(),
      { send },
    );
  const request = (userId: string, createdAt: Date) => ({
    userId,
    topic: 'payments' as const,
    message: 'A payment did not arrive.',
    contactEmail: null,
    appVersion: null,
    platform: null,
    createdAt,
  });

  it('finds who a request is from: their address, and the vault before the wallet', async () => {
    const withVault = await consumer({ vault: true });
    const walletOnly = await consumer({ email: null });

    await expect(store().findRequester(withVault.id)).resolves.toEqual({
      email: `${withVault.id}@example.com`,
      accountAddress: withVault.vault,
    });
    await expect(store().findRequester(walletOnly.id)).resolves.toEqual({
      email: null,
      accountAddress: walletOnly.wallet,
    });
    await expect(store().findRequester('nobody')).resolves.toEqual({
      email: null,
      accountAddress: null,
    });
  });

  it("counts one Consumer's requests, and only those after the instant given", async () => {
    const alice = await consumer();
    const bob = await consumer();
    await store().insert(request(alice.id, T0));
    await store().insert(request(alice.id, after(MINUTE)));
    await store().insert(request(bob.id, after(MINUTE)));

    await expect(store().countSince(alice.id, after(-1))).resolves.toBe(2);
    await expect(store().countSince(alice.id, T0)).resolves.toBe(1);
    await expect(store().countSince(alice.id, after(MINUTE))).resolves.toBe(0);
    await expect(store().countSince(bob.id, after(-1))).resolves.toBe(1);
  });

  it('stores a request open, with what was written and the address at the time', async () => {
    const alice = await consumer();

    const { id, replyTo } = await service().create(
      alice.id,
      {
        topic: 'earn_swap',
        message: 'My swap is pending.',
        appVersion: '1.4.0',
        platform: 'ios',
      },
      T0,
    );

    expect(replyTo).toBe(`${alice.id}@example.com`);
    const [row] = await db.client
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, id));
    expect(row).toEqual({
      id,
      userId: alice.id,
      topic: 'earn_swap',
      message: 'My swap is pending.',
      contactEmail: `${alice.id}@example.com`,
      appVersion: '1.4.0',
      platform: 'ios',
      status: 'open',
      createdAt: T0,
      closedAt: null,
    });
  });

  it('lets exactly five through when eight arrive together', async () => {
    const alice = await consumer();
    const send = jest.fn().mockResolvedValue(undefined);
    const support = service(send);

    const settled = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        support.create(alice.id, { topic: 'other', message: 'hello' }, T0),
      ),
    );

    const refused = rejections(settled);
    expect(refused).toHaveLength(3);
    for (const err of refused) {
      expect(err).toBeInstanceOf(SupportRateLimitedError);
    }
    await expect(store().countSince(alice.id, after(-1))).resolves.toBe(5);
    expect(send).toHaveBeenCalledTimes(5);
  });

  it('closes a request once, and tells a repeat and a stranger apart', async () => {
    const alice = await consumer();
    const id = await store().insert(request(alice.id, T0));
    const closedAt = after(MINUTE);

    await expect(store().close(id, closedAt)).resolves.toBe('closed');
    await expect(store().close(id, after(2 * MINUTE))).resolves.toBe(
      'already_closed',
    );
    await expect(store().close('sr_nobody', closedAt)).resolves.toBe(
      'not_found',
    );

    const [row] = await db.client
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, id));
    expect(row).toMatchObject({ status: 'closed', closedAt });
  });

  it('holds the status to open or closed', async () => {
    const alice = await consumer();

    await expect(
      sqlState(
        db.client.insert(supportRequests).values({
          ...request(alice.id, T0),
          status: 'pending' as 'open',
        }),
      ),
    ).resolves.toBe(CHECK_VIOLATION);
  });

  describe('feedback', () => {
    const feedbackStore = () => new DrizzleFeedbackStore(db);
    const row = (userId: string, rating: number | null) => ({
      userId,
      message: 'Clearer than before.',
      rating,
      appVersion: null,
      platform: null,
      createdAt: T0,
    });

    it('takes a rating from one to five, or none, and nothing else', async () => {
      const alice = await consumer();

      await expect(feedbackStore().insert(row(alice.id, 1))).resolves.toEqual(
        expect.any(String),
      );
      await expect(feedbackStore().insert(row(alice.id, 5))).resolves.toEqual(
        expect.any(String),
      );
      await expect(
        feedbackStore().insert(row(alice.id, null)),
      ).resolves.toEqual(expect.any(String));
      await expect(
        sqlState(feedbackStore().insert(row(alice.id, 0))),
      ).resolves.toBe(CHECK_VIOLATION);
      await expect(
        sqlState(feedbackStore().insert(row(alice.id, 6))),
      ).resolves.toBe(CHECK_VIOLATION);
    });

    it('lets exactly ten through in a day, counted for one Consumer alone', async () => {
      const alice = await consumer();
      const bob = await consumer();
      const service = new FeedbackService(feedbackStore());

      for (let i = 0; i < 10; i += 1) {
        await service.create(alice.id, { message: 'hello' }, after(i * MINUTE));
      }

      await expect(
        service.create(alice.id, { message: 'hello' }, after(11 * MINUTE)),
      ).rejects.toBeInstanceOf(FeedbackRateLimitedError);
      await expect(
        service.create(bob.id, { message: 'hello' }, after(11 * MINUTE)),
      ).resolves.toEqual({ id: expect.any(String) as string });
      await expect(
        service.create(alice.id, { message: 'hello' }, after(24 * 60 * MINUTE)),
      ).resolves.toEqual({ id: expect.any(String) as string });
    });
  });

  describe('deleting the account', () => {
    function walletsService() {
      return new WalletsService(
        db,
        {
          getSolBalance: jest.fn().mockResolvedValue(0n),
          getTokenBalances: jest.fn().mockResolvedValue([]),
        } as unknown as SolanaRpc,
        {} as TokenPriceProvider,
        {} as TokenMetadataProvider,
        { get: () => undefined } as unknown as ConfigService,
      );
    }

    async function withRequest() {
      const who = await consumer();
      await db.client.insert(supportRequests).values({
        userId: who.id,
        topic: 'payments',
        message: 'A payment did not arrive.',
        contactEmail: `${who.id}@example.com`,
        createdAt: T0,
      });
      await db.client.insert(feedback).values({
        userId: who.id,
        message: 'Clearer than before.',
        rating: 4,
        createdAt: T0,
      });
      return who;
    }

    const requestsFor = (userId: string) =>
      db.client
        .select({
          message: supportRequests.message,
          contactEmail: supportRequests.contactEmail,
        })
        .from(supportRequests)
        .where(eq(supportRequests.userId, userId));

    const feedbackFor = async (userId: string) =>
      (
        await db.client
          .select({ message: feedback.message })
          .from(feedback)
          .where(eq(feedback.userId, userId))
      ).map((f) => f.message);

    it("takes the reply address off what they wrote, keeps the rest, and touches nobody else's", async () => {
      const leaving = await withRequest();
      const staying = await withRequest();

      await expect(walletsService().deleteMe(leaving.id)).resolves.toEqual({
        deleted: true,
      });

      await expect(requestsFor(leaving.id)).resolves.toEqual([
        { message: 'A payment did not arrive.', contactEmail: null },
      ]);
      await expect(feedbackFor(leaving.id)).resolves.toEqual([
        'Clearer than before.',
      ]);
      const [user] = await db.client
        .select({ email: users.email, deletedAt: users.deletedAt })
        .from(users)
        .where(eq(users.id, leaving.id));
      expect(user.email).toBe(`deleted-${leaving.id}@deleted.prydd.internal`);
      expect(user.deletedAt).not.toBeNull();

      await expect(requestsFor(staying.id)).resolves.toEqual([
        {
          message: 'A payment did not arrive.',
          contactEmail: `${staying.id}@example.com`,
        },
      ]);
    });
  });
});
