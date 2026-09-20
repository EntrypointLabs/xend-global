import { Test } from '@nestjs/testing';
import {
  Controller,
  Get,
  INestApplication,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import request from 'supertest';
import type { Server } from 'node:http';
import { z } from 'zod';
import { MerchantPortalController } from '../src/merchant/merchant-portal.controller';
import { MerchantIdentityService } from '../src/merchant/merchant-identity.service';
import { KeyIssuanceService } from '../src/merchant/key-issuance.service';
import { SettlementProvisioningService } from '../src/settlement/settlement-provisioning.service';
import { DbService } from '../src/db/db.service';
import * as schema from '../src/db/schema';
import { ApiKeyGuard } from '../src/merchant/api-key.guard';

@Controller('test-key-access')
class KeyAccessProbe {
  @Get()
  @UseGuards(ApiKeyGuard)
  read() {
    return { ok: true };
  }
}

// Explicit opt-in only. TEMP tables shadow Merchant data on this connection;
// no real Merchant is inserted, edited or deleted by these tests.
const databaseUrl = process.env.MERCHANT_PROFILE_TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)(
  'Merchant profile HTTP + PostgreSQL',
  () => {
    let client: Client;
    let app: INestApplication;
    let controller: MerchantPortalController;
    const body = {
      expectedVersion: 0,
      displayName: 'Store A edited',
      profile: {
        legalName: '',
        contactName: 'Test contact',
        contactEmail: 'test@example.com',
        phone: '',
        website: '',
        addressLine1: '',
        addressLine2: '',
        city: '',
        region: '',
        postalCode: '',
        country: '',
      },
    };
    beforeAll(async () => {
      if (!['localhost', '127.0.0.1'].includes(new URL(databaseUrl!).hostname))
        throw new Error('Profile tests require a local database');
      client = new Client({ connectionString: databaseUrl });
      await client.connect();
      await client.query(
        'CREATE TEMP TABLE merchants (LIKE public.merchants INCLUDING ALL)',
      );
      await client.query(
        'CREATE TEMP TABLE api_keys (LIKE public.api_keys INCLUDING ALL)',
      );
      const module = await Test.createTestingModule({
        controllers: [MerchantPortalController, KeyAccessProbe],
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
          KeyIssuanceService,
          ApiKeyGuard,
          { provide: SettlementProvisioningService, useValue: {} },
          {
            provide: ConfigService,
            useValue: new ConfigService({ SOLANA_CLUSTER: 'devnet' }),
          },
        ],
      }).compile();
      controller = module.get(MerchantPortalController);
      app = module.createNestApplication();
      await app.init();
    });
    beforeEach(async () => {
      await client.query('TRUNCATE pg_temp.api_keys');
      await client.query('TRUNCATE pg_temp.merchants');
      await client.query(
        "INSERT INTO pg_temp.merchants (id, owner_provider_id, name, display_name) VALUES ('profile-test-a', 'owner-a', 'Store A', 'Store A'), ('profile-test-b', 'owner-b', 'Store B', 'Store B')",
      );
    });
    afterAll(async () => {
      await app?.close();
      await client?.end();
    });
    afterEach(() => jest.restoreAllMocks());
    const save = (token: string, data = body) =>
      request(app.getHttpServer() as Server)
        .post('/merchant-portal/profile')
        .set('Authorization', `Bearer ${token}`)
        .send(data);

    const revoke = (token: string, id: string) =>
      request(app.getHttpServer() as Server)
        .post(`/merchant-portal/keys/${id}/revoke`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

    it('revokes an owned key persistently, rejects subsequent API use and preserves the first timestamp on retry', async () => {
      const issued = await request(app.getHttpServer() as Server)
        .post('/merchant-portal/keys')
        .set('Authorization', 'Bearer owner-a')
        .send({ mode: 'test' })
        .expect(201);
      const {
        rows: [key],
      } = await client.query<{ id: string }>('SELECT id FROM pg_temp.api_keys');
      const issuedKey = z.object({ raw: z.string() }).parse(issued.body);
      await request(app.getHttpServer() as Server)
        .get('/test-key-access')
        .set('Authorization', `Bearer ${issuedKey.raw}`)
        .expect(200);
      const first = await revoke('owner-a', key.id).expect(201);
      const retry = await revoke('owner-a', key.id).expect(201);
      expect(retry.body).toEqual(first.body);
      const {
        rows: [stored],
      } = await client.query<{ revoked_at: Date }>(
        "SELECT revoked_at AT TIME ZONE 'UTC' AS revoked_at FROM pg_temp.api_keys WHERE id = $1",
        [key.id],
      );
      expect(stored.revoked_at.toISOString()).toBe(
        z.object({ revokedAt: z.string() }).parse(first.body).revokedAt,
      );
      await request(app.getHttpServer() as Server)
        .get('/test-key-access')
        .set('Authorization', `Bearer ${issuedKey.raw}`)
        .expect(401);
    });

    it('hides foreign and missing keys identically, and leaves the foreign key active', async () => {
      await request(app.getHttpServer() as Server)
        .post('/merchant-portal/keys')
        .set('Authorization', 'Bearer owner-b')
        .send({ mode: 'test' })
        .expect(201);
      const {
        rows: [key],
      } = await client.query<{ id: string }>('SELECT id FROM pg_temp.api_keys');
      const foreign = await revoke('owner-a', key.id).expect(404);
      const missing = await revoke('owner-a', 'missing-key').expect(404);
      expect(foreign.body).toEqual(missing.body);
      await revoke('invalid', key.id).expect(401);
      await request(app.getHttpServer() as Server)
        .post(`/merchant-portal/keys/${key.id}/revoke`)
        .send({})
        .expect(401);
      const {
        rows: [stored],
      } = await client.query<{ revoked_at: Date | null }>(
        'SELECT revoked_at FROM pg_temp.api_keys WHERE id = $1',
        [key.id],
      );
      expect(stored.revoked_at).toBeNull();
    });

    it('rejects a legal-name edit when verification lands after the initial read', async () => {
      // Interpose only the timing boundary. Both the ownership read and final
      // conditional UPDATE still run against PostgreSQL through the real route.
      const boundary = controller as unknown as {
        owned: (
          authorization?: string,
        ) => Promise<
          typeof schema.merchants.$inferSelect & { signInEmail: string | null }
        >;
      };
      const readOwned = boundary.owned.bind(
        controller,
      ) as typeof boundary.owned;
      jest
        .spyOn(boundary, 'owned')
        .mockImplementationOnce(async (authorization) => {
          const merchant = await readOwned(authorization);
          await client.query(
            "UPDATE pg_temp.merchants SET kyb_status = 'verified' WHERE id = 'profile-test-a'",
          );
          return merchant;
        });
      await save('owner-a', {
        ...body,
        profile: { ...body.profile, legalName: 'Unreviewed name' },
      }).expect(409);
      const result = await client.query(
        "SELECT kyb_status, business_profile, profile_version FROM pg_temp.merchants WHERE id = 'profile-test-a'",
      );
      expect(result.rows[0]).toEqual({
        kyb_status: 'verified',
        business_profile: {},
        profile_version: 0,
      });
    });

    it('persists edits only for the authenticated owner and returns verified identity separately', async () => {
      const result = await save('owner-a').expect(201);
      const dashboardSchema = z.object({
        merchant: z.object({
          signInEmail: z.string(),
          businessProfile: z.object({ contactName: z.string() }),
          profileVersion: z.number(),
        }),
      });
      expect(dashboardSchema.parse(result.body).merchant.signInEmail).toBe(
        'owner-a@example.com',
      );
      const loaded = await request(app.getHttpServer() as Server)
        .get('/merchant-portal/me')
        .set('Authorization', 'Bearer owner-a')
        .expect(200);
      const dashboard = dashboardSchema.parse(loaded.body);
      expect(dashboard.merchant.businessProfile.contactName).toBe(
        'Test contact',
      );
      expect(dashboard.merchant.profileVersion).toBe(1);
      const other = await client.query(
        "SELECT display_name, profile_version FROM pg_temp.merchants WHERE id = 'profile-test-b'",
      );
      expect(other.rows[0]).toEqual({
        display_name: 'Store B',
        profile_version: 0,
      });
    });
    it('allows exactly one of two saves from the same version', async () => {
      const responses = await Promise.all([
        save('owner-a'),
        save('owner-a', { ...body, displayName: 'Other edit' }),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        (
          await client.query<{ profile_version: number }>(
            "SELECT profile_version FROM pg_temp.merchants WHERE id = 'profile-test-a'",
          )
        ).rows[0].profile_version,
      ).toBe(1);
    });
    it('rejects forged ownership or verification fields before mutation', async () => {
      await request(app.getHttpServer() as Server)
        .post('/merchant-portal/profile')
        .set('Authorization', 'Bearer owner-a')
        .send({ ...body, id: 'profile-test-b', kybStatus: 'verified' })
        .expect(400);
      expect(
        (
          await client.query<{ profile_version: number }>(
            'SELECT profile_version FROM pg_temp.merchants',
          )
        ).rows.every((r) => r.profile_version === 0),
      ).toBe(true);
    });
    it('rejects missing or invalid authentication', async () => {
      await request(app.getHttpServer() as Server)
        .post('/merchant-portal/profile')
        .send(body)
        .expect(401);
      await save('invalid').expect(401);
    });
    it('protects a verified legal name while allowing contact edits', async () => {
      await client.query(
        "UPDATE pg_temp.merchants SET kyb_status = 'verified', business_profile = '{\"legalName\":\"Approved Business\"}' WHERE id = 'profile-test-a'",
      );
      await save('owner-a').expect(409);
      await save('owner-a', {
        ...body,
        profile: { ...body.profile, legalName: 'Approved Business' },
      }).expect(201);
    });
  },
);
