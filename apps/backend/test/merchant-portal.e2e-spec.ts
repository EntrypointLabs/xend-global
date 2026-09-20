import { Test } from '@nestjs/testing';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import request from 'supertest';
import type { Response } from 'supertest';
import type { Server } from 'node:http';
import { MerchantPortalController } from '../src/merchant/merchant-portal.controller';
import { MerchantPortalWebhooksController } from '../src/merchant/merchant-portal-webhooks.controller';
import { MerchantPortalPaymentsController } from '../src/merchant/merchant-portal-payments.controller';
import { MerchantPortalAuditController } from '../src/merchant/merchant-portal-audit.controller';
import { MerchantIdentityService } from '../src/merchant/merchant-identity.service';
import { MerchantOwnerService } from '../src/merchant/merchant-owner.service';
import { MerchantAuditService } from '../src/merchant/merchant-audit.service';
import { KeyIssuanceService } from '../src/merchant/key-issuance.service';
import { WebhookEndpointService } from '../src/webhook/webhook-endpoint.service';
import { SettlementProvisioningService } from '../src/settlement/settlement-provisioning.service';
import { DbService } from '../src/db/db.service';
import * as schema from '../src/db/schema';

/** supertest hands back `any`; read it through one typed accessor. */
function body<T>(res: Response): T {
  return res.body as T;
}

type KeyView = {
  id: string;
  name: string | null;
  mode: string;
  rotatedFromId: string | null;
};
type MeView = { keys: KeyView[]; merchant: Record<string, unknown> };
type EndpointView = { id: string; secret?: string };
type PaymentSummary = { id: string; merchantReference: string | null };
type PaymentPage = { payments: PaymentSummary[]; nextCursor: string | null };
type AuditPage = { entries: { action: string }[] };

// The minimum business details a KYB submission now requires.
const COMPLETE_PROFILE = JSON.stringify({
  legalName: 'Acme LLC',
  contactName: 'Ada Owner',
  contactEmail: 'ada@acme.example',
  addressLine1: '1 Main Street',
  city: 'Lagos',
  country: 'NG',
});

// Explicit opt-in only. TEMP tables shadow the real Merchant data on this one
// connection; no real row is inserted, edited or deleted by these tests.
const databaseUrl = process.env.MERCHANT_PROFILE_TEST_DATABASE_URL;
const TEMP_TABLES = [
  'merchants',
  'api_keys',
  'merchant_audit_log',
  'webhook_endpoints',
  'webhook_deliveries',
  'payment_intents',
  'payment_attempts',
  'payments',
  'settlement_accounts',
];

(databaseUrl ? describe : describe.skip)(
  'Merchant portal endpoints HTTP + PostgreSQL',
  () => {
    let client: Client;
    let app: INestApplication;
    let ownerService: MerchantOwnerService;

    const auth = (token: string) => `Bearer ${token}`;
    const server = () => app.getHttpServer() as Server;

    beforeAll(async () => {
      if (!['localhost', '127.0.0.1'].includes(new URL(databaseUrl!).hostname))
        throw new Error('Portal tests require a local database');
      client = new Client({ connectionString: databaseUrl });
      await client.connect();
      for (const table of TEMP_TABLES)
        await client.query(
          `CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS)`,
        );
      const module = await Test.createTestingModule({
        controllers: [
          MerchantPortalController,
          MerchantPortalWebhooksController,
          MerchantPortalPaymentsController,
          MerchantPortalAuditController,
        ],
        providers: [
          {
            provide: DbService,
            useValue: { client: drizzle(client, { schema }) },
          },
          {
            provide: MerchantIdentityService,
            useValue: {
              verifyIdToken: (token: string) => {
                if (!['owner-a', 'owner-b'].includes(token))
                  throw new UnauthorizedException();
                return Promise.resolve({
                  providerUserId: token,
                  email: `${token}@example.com`,
                });
              },
            },
          },
          MerchantOwnerService,
          MerchantAuditService,
          KeyIssuanceService,
          WebhookEndpointService,
          { provide: SettlementProvisioningService, useValue: {} },
          {
            provide: ConfigService,
            useValue: new ConfigService({
              SOLANA_CLUSTER: 'devnet',
              WEBHOOK_ALLOW_PRIVATE_URLS: true,
              WEBHOOK_SECRET_ROTATION_GRACE_HOURS: 24,
            }),
          },
        ],
      }).compile();
      ownerService = module.get(MerchantOwnerService);
      app = module.createNestApplication();
      await app.init();
    });

    afterEach(() => jest.restoreAllMocks());

    beforeEach(async () => {
      for (const table of [...TEMP_TABLES].reverse())
        await client.query(`TRUNCATE pg_temp.${table} CASCADE`);
      await client.query(
        "INSERT INTO pg_temp.merchants (id, owner_provider_id, name, display_name) VALUES ('m-a', 'owner-a', 'Store A', 'Store A'), ('m-b', 'owner-b', 'Store B', 'Store B')",
      );
    });

    afterAll(async () => {
      await app?.close();
      await client?.end();
    });

    const issueKey = (token: string, payload: Record<string, unknown>) =>
      request(server())
        .post('/merchant-portal/keys')
        .set('Authorization', auth(token))
        .send(payload);

    describe('API keys', () => {
      it('issues a named key and lists its metadata without the secret', async () => {
        await issueKey('owner-a', { mode: 'test', name: 'Storefront' }).expect(
          201,
        );
        const me = body<MeView>(
          await request(server())
            .get('/merchant-portal/me')
            .set('Authorization', auth('owner-a'))
            .expect(200),
        );
        expect(me.keys).toHaveLength(1);
        expect(me.keys[0].name).toBe('Storefront');
        expect(me.keys[0].mode).toBe('test');
        expect(me.keys[0]).not.toHaveProperty('keyHash');
        expect(me.merchant).not.toHaveProperty('ownerProviderId');
      });

      it('rotates a key: the successor keeps the name and links to its predecessor, the old one enters a grace window rather than being revoked', async () => {
        const issued = body<{ raw: string }>(
          await issueKey('owner-a', { mode: 'test', name: 'Rotate me' }).expect(
            201,
          ),
        );
        const {
          rows: [key],
        } = await client.query<{ id: string }>(
          'SELECT id FROM pg_temp.api_keys',
        );
        const rotated = body<{ raw: string; previousKeyExpiresAt: string }>(
          await request(server())
            .post(`/merchant-portal/keys/${key.id}/rotate`)
            .set('Authorization', auth('owner-a'))
            .send({})
            .expect(201),
        );
        expect(rotated.raw).not.toBe(issued.raw);
        // The response tells the caller how long the previous key keeps working.
        expect(Number.isNaN(Date.parse(rotated.previousKeyExpiresAt))).toBe(
          false,
        );
        const rows = await client.query<{
          id: string;
          name: string | null;
          rotated_from_id: string | null;
          revoked_at: Date | null;
          rotation_grace_until: Date | null;
        }>(
          'SELECT id, name, rotated_from_id, revoked_at, rotation_grace_until FROM pg_temp.api_keys ORDER BY created_at',
        );
        expect(rows.rows).toHaveLength(2);
        const old = rows.rows.find((r) => r.id === key.id);
        const next = rows.rows.find((r) => r.id !== key.id);
        // The old key is not revoked; it stays valid until its grace window.
        expect(old?.revoked_at).toBeNull();
        expect(old?.rotation_grace_until).not.toBeNull();
        expect(old?.rotation_grace_until!.getTime()).toBeGreaterThan(
          Date.now(),
        );
        expect(next?.revoked_at).toBeNull();
        expect(next?.rotation_grace_until).toBeNull();
        expect(next?.name).toBe('Rotate me');
        expect(next?.rotated_from_id).toBe(key.id);
      });

      it('does not rotate a key owned by another Merchant', async () => {
        await issueKey('owner-b', { mode: 'test' }).expect(201);
        const {
          rows: [key],
        } = await client.query<{ id: string }>(
          'SELECT id FROM pg_temp.api_keys',
        );
        await request(server())
          .post(`/merchant-portal/keys/${key.id}/rotate`)
          .set('Authorization', auth('owner-a'))
          .send({})
          .expect(404);
      });
    });

    describe('Webhooks', () => {
      const createEndpoint = (token: string, url: string) =>
        request(server())
          .post('/merchant-portal/webhooks')
          .set('Authorization', auth(token))
          .send({ url, mode: 'test' });

      it('creates, lists, rotates and deletes an owner endpoint, hiding the secret on reads', async () => {
        const created = body<EndpointView>(
          await createEndpoint('owner-a', 'https://example.com/hook').expect(
            201,
          ),
        );
        expect(created.secret).toMatch(/^whsec_/);
        const id = created.id;

        const list = body<{ endpoints: EndpointView[] }>(
          await request(server())
            .get('/merchant-portal/webhooks')
            .set('Authorization', auth('owner-a'))
            .expect(200),
        );
        expect(list.endpoints).toHaveLength(1);
        expect(list.endpoints[0]).not.toHaveProperty('secret');
        expect(list.endpoints[0]).not.toHaveProperty('secretPrimary');

        const rotated = body<{
          secret: string;
          previousSecretExpiresAt: string;
        }>(
          await request(server())
            .post(`/merchant-portal/webhooks/${id}/rotate_secret`)
            .set('Authorization', auth('owner-a'))
            .send({})
            .expect(201),
        );
        expect(rotated.secret).toMatch(/^whsec_/);
        expect(rotated.secret).not.toBe(created.secret);
        expect(rotated.previousSecretExpiresAt).toBeTruthy();

        await request(server())
          .post(`/merchant-portal/webhooks/${id}/delete`)
          .set('Authorization', auth('owner-a'))
          .send({})
          .expect(201);
        const after = body<{ endpoints: EndpointView[] }>(
          await request(server())
            .get('/merchant-portal/webhooks')
            .set('Authorization', auth('owner-a'))
            .expect(200),
        );
        expect(after.endpoints).toHaveLength(0);
      });

      it('rejects a non-HTTPS endpoint URL with 422', async () => {
        await createEndpoint('owner-a', 'http://example.com/hook').expect(422);
      });

      it('does not let an owner read another Merchant endpoint deliveries', async () => {
        const created = body<EndpointView>(
          await createEndpoint('owner-b', 'https://example.com/b').expect(201),
        );
        await request(server())
          .get(`/merchant-portal/webhooks/${created.id}/deliveries`)
          .set('Authorization', auth('owner-a'))
          .expect(404);
      });
    });

    describe('Payments', () => {
      beforeEach(async () => {
        for (let i = 0; i < 3; i++)
          await client.query(
            `INSERT INTO pg_temp.payment_intents
             (id, merchant_id, usdc_settlement_raw, display_currency, display_amount_minor, expires_at, status, merchant_reference, execution_cluster, created_at)
             VALUES ($1, 'm-a', '1000000', 'USD', '100', now() + interval '1 hour', $2, $3, 'devnet', now() + ($4 || ' seconds')::interval)`,
            [
              `pi_a${i}`,
              i === 0 ? 'succeeded' : 'created',
              `order-${i}`,
              String(i),
            ],
          );
        await client.query(
          `INSERT INTO pg_temp.payment_intents
           (id, merchant_id, usdc_settlement_raw, display_currency, display_amount_minor, expires_at, status, execution_cluster, created_at)
           VALUES ('pi_b0', 'm-b', '1000000', 'USD', '100', now() + interval '1 hour', 'created', 'devnet', now())`,
        );
      });

      it('paginates a Merchant only over its own Payments', async () => {
        const first = body<PaymentPage>(
          await request(server())
            .get('/merchant-portal/payments?limit=2')
            .set('Authorization', auth('owner-a'))
            .expect(200),
        );
        expect(first.payments).toHaveLength(2);
        expect(first.nextCursor).toBeTruthy();
        const second = body<PaymentPage>(
          await request(server())
            .get(
              `/merchant-portal/payments?limit=2&cursor=${first.nextCursor ?? ''}`,
            )
            .set('Authorization', auth('owner-a'))
            .expect(200),
        );
        expect(second.payments).toHaveLength(1);
        expect(second.nextCursor).toBeNull();
        const ids = [...first.payments, ...second.payments].map((p) => p.id);
        expect(ids).not.toContain('pi_b0');
      });

      it('filters by status and searches by reference', async () => {
        const byStatus = body<PaymentPage>(
          await request(server())
            .get('/merchant-portal/payments?status=succeeded')
            .set('Authorization', auth('owner-a'))
            .expect(200),
        );
        expect(byStatus.payments).toHaveLength(1);
        expect(byStatus.payments[0].id).toBe('pi_a0');
        const byRef = body<PaymentPage>(
          await request(server())
            .get('/merchant-portal/payments?q=order-2')
            .set('Authorization', auth('owner-a'))
            .expect(200),
        );
        expect(byRef.payments).toHaveLength(1);
        expect(byRef.payments[0].merchantReference).toBe('order-2');
      });

      it('returns detail with confirmation reference and blocks cross-Merchant reads', async () => {
        await client.query(
          `INSERT INTO pg_temp.payment_attempts (id, intent_id, status, tx_signature)
           VALUES ('att-1', 'pi_a0', 'succeeded', 'sig-123')`,
        );
        const detail = body<{ confirmationReference: string | null }>(
          await request(server())
            .get('/merchant-portal/payments/pi_a0')
            .set('Authorization', auth('owner-a'))
            .expect(200),
        );
        expect(detail.confirmationReference).toBe('sig-123');
        await request(server())
          .get('/merchant-portal/payments/pi_b0')
          .set('Authorization', auth('owner-a'))
          .expect(404);
      });
    });

    describe('Audit trail', () => {
      it('records sensitive writes and returns them owner-scoped', async () => {
        await issueKey('owner-a', { mode: 'test', name: 'Audit key' }).expect(
          201,
        );
        await client.query(
          `UPDATE pg_temp.merchants SET business_profile = $1 WHERE id = 'm-a'`,
          [COMPLETE_PROFILE],
        );
        await request(server())
          .post('/merchant-portal/kyb/submit')
          .set('Authorization', auth('owner-a'))
          .expect(201);
        const audit = body<AuditPage>(
          await request(server())
            .get('/merchant-portal/audit')
            .set('Authorization', auth('owner-a'))
            .expect(200),
        );
        const actions = audit.entries.map((e) => e.action);
        expect(actions).toContain('api_key.issue');
        expect(actions).toContain('kyb.submit');
        const other = body<AuditPage>(
          await request(server())
            .get('/merchant-portal/audit')
            .set('Authorization', auth('owner-b'))
            .expect(200),
        );
        expect(other.entries).toHaveLength(0);
      });
    });

    describe('Race safety', () => {
      it('refuses to re-rotate a key already in its grace window and leaves exactly one successor', async () => {
        await issueKey('owner-a', { mode: 'test', name: 'Once' }).expect(201);
        const {
          rows: [key],
        } = await client.query<{ id: string }>(
          'SELECT id FROM pg_temp.api_keys',
        );
        await request(server())
          .post(`/merchant-portal/keys/${key.id}/rotate`)
          .set('Authorization', auth('owner-a'))
          .send({})
          .expect(201);
        // The original is in its grace window (still valid), not revoked, so a
        // retried rotation conflicts instead of minting a second successor.
        await request(server())
          .post(`/merchant-portal/keys/${key.id}/rotate`)
          .set('Authorization', auth('owner-a'))
          .send({})
          .expect(409);
        const successors = await client.query(
          'SELECT id FROM pg_temp.api_keys WHERE rotated_from_id = $1',
          [key.id],
        );
        expect(successors.rows).toHaveLength(1);
        // Access is preserved: the original key is not revoked.
        const original = await client.query<{ revoked_at: Date | null }>(
          'SELECT revoked_at FROM pg_temp.api_keys WHERE id = $1',
          [key.id],
        );
        expect(original.rows[0]?.revoked_at).toBeNull();
      });

      it('does not revert a merchant verified between the read and the KYB submit update', async () => {
        // A complete profile so the submission passes the minimum-details gate
        // and reaches the conditional update this test is about.
        await client.query(
          `UPDATE pg_temp.merchants SET business_profile = $1 WHERE id = 'm-a'`,
          [COMPLETE_PROFILE],
        );
        const boundary = ownerService as unknown as {
          owned: (authorization?: string) => Promise<
            typeof schema.merchants.$inferSelect & {
              signInEmail: string | null;
            }
          >;
        };
        const readOwned = boundary.owned.bind(
          ownerService,
        ) as typeof boundary.owned;
        jest
          .spyOn(boundary, 'owned')
          .mockImplementationOnce(async (authorization) => {
            const merchant = await readOwned(authorization);
            await client.query(
              "UPDATE pg_temp.merchants SET kyb_status = 'verified' WHERE id = 'm-a'",
            );
            return merchant;
          });
        await request(server())
          .post('/merchant-portal/kyb/submit')
          .set('Authorization', auth('owner-a'))
          .expect(409);
        const {
          rows: [row],
        } = await client.query<{ kyb_status: string }>(
          "SELECT kyb_status FROM pg_temp.merchants WHERE id = 'm-a'",
        );
        expect(row.kyb_status).toBe('verified');
      });

      it('refuses a KYB submission with no business details and leaves the status untouched', async () => {
        await request(server())
          .post('/merchant-portal/kyb/submit')
          .set('Authorization', auth('owner-a'))
          .expect(409);
        const {
          rows: [row],
        } = await client.query<{
          kyb_status: string;
          kyb_submitted_at: Date | null;
        }>(
          "SELECT kyb_status, kyb_submitted_at FROM pg_temp.merchants WHERE id = 'm-a'",
        );
        expect(row.kyb_status).toBe('pending');
        expect(row.kyb_submitted_at).toBeNull();
      });
    });

    describe('Webhook delivery pagination', () => {
      it('pages through more deliveries than one page and never truncates silently', async () => {
        const created = await request(server())
          .post('/merchant-portal/webhooks')
          .set('Authorization', auth('owner-a'))
          .send({ url: 'https://example.com/hook', mode: 'test' })
          .expect(201);
        const endpointId = (created.body as { id: string }).id;
        for (let i = 0; i < 25; i++)
          await client.query(
            `INSERT INTO pg_temp.webhook_deliveries
             (id, endpoint_id, event_id, event_type, payload, correlation_id, created_at)
             VALUES ($1, $2, $3, 'payment.succeeded', '{}', $4, now() + ($5 || ' seconds')::interval)`,
            [`wd_${i}`, endpointId, `evt_${i}`, `pi_${i}`, String(i)],
          );
        const first = await request(server())
          .get(`/merchant-portal/webhooks/${endpointId}/deliveries?limit=20`)
          .set('Authorization', auth('owner-a'))
          .expect(200);
        const firstBody = first.body as {
          deliveries: unknown[];
          nextCursor: string | null;
        };
        expect(firstBody.deliveries).toHaveLength(20);
        expect(firstBody.nextCursor).toBeTruthy();
        const second = await request(server())
          .get(
            `/merchant-portal/webhooks/${endpointId}/deliveries?limit=20&cursor=${firstBody.nextCursor ?? ''}`,
          )
          .set('Authorization', auth('owner-a'))
          .expect(200);
        const secondBody = second.body as {
          deliveries: unknown[];
          nextCursor: string | null;
        };
        expect(secondBody.deliveries).toHaveLength(5);
        expect(secondBody.nextCursor).toBeNull();
      });
    });
  },
);
