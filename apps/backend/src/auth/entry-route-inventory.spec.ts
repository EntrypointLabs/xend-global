import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService, Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Test } from '@nestjs/testing';

import { applyAppModuleTestEnv } from '../app.module.test-env';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { ALLOW_ENTRY } from './allow-entry.decorator';
import { ConsumerAuthGuard } from './consumer-auth.guard';

/**
 * Every route the backend serves, and what an entry session may do with it.
 *
 * An entry session is what an email code opens on an Account that already
 * exists. It can look, and it can start a lost-phone recovery. It cannot
 * spend, change the signer set, change the contact address, or enrol a
 * passkey, because any of those from an inbox alone would let one mailbox
 * hold two signers.
 *
 * The guard closes every route by default; this test is what makes the
 * default a decision rather than an accident. A route is either listed as
 * open to entry or listed as closed, and a route in neither list fails the
 * build until somebody decides. Adding a route here means having read the
 * capability table and being able to say which row it falls under.
 */

/** Reachable with an entry token. Each one is read-only or starts a recovery. */
const ENTRY_ALLOWED: readonly string[] = [
  'GET /wallet/me',
  'GET /wallet/me/balances',
  'GET /transfers',
  'GET /account/me',
  'GET /account/recovery',
  'GET /account/changes/pending',
  'POST /account/recovery/device/challenge',
  'POST /account/recovery/device/verify',
  'POST /account/recovery/device/start',
  'POST /account/recovery/device/next',
  'POST /account/recovery/device/submit',
  'GET /consumers/me/sessions',
  'DELETE /consumers/me/sessions/:id',
  'POST /auth/signout',
];

/**
 * Closed to an entry token. Listed rather than implied, so that a new route
 * has to be placed here on purpose. Grouped by why.
 */
const CLOSED_TO_ENTRY: readonly string[] = [
  // Spending, at any amount.
  'POST /transfers/prepare',
  'POST /transfers/submit',
  'GET /payments/pending',
  'POST /payments/pending/:reference/prepare',
  'POST /payments/pending/:reference/submit',
  'GET /account/sweep',
  // Enrolling a credential or a signer on an existing Account.
  'POST /auth/passkey-credentials',
  'POST /account/enrolment/nonce',
  'POST /account/enrolment',
  'POST /account/provisioning/next',
  'POST /account/provisioning/submit',
  // Changing the signer set or a policy, and staging or deciding a change.
  'POST /account/changes/reject/prepare',
  'POST /account/changes/reject/submit',
  'POST /account/recovery/external-wallet',
  'POST /account/recovery/email/challenge',
  'POST /account/recovery/email/verify',
  'POST /account/recovery/email',
  'POST /account/recovery/:id/remove',
  'POST /account/recovery/change/next',
  'POST /account/recovery/change/submit',
  // The contact address, and closing the account.
  'POST /auth/email/challenge',
  'POST /auth/email',
  'DELETE /wallet/me',
  // Where notices go and whether they are wanted.
  'POST /notifications/devices',
  'DELETE /notifications/devices',
  'GET /notifications/preferences',
  'PUT /notifications/preferences',
  // Not Consumer routes at all: no session of either tier reaches these.
  'GET /',
  'POST /auth/exchange',
  'POST /auth/signup/email/challenge',
  'POST /auth/signup/email',
  'GET /checkout/intents/:reference',
  'POST /checkout/authorize',
  'POST /checkout/settle',
  'POST /v1/payment_intents',
  'GET /v1/payment_intents/:id',
  'POST /internal/refunds',
  'POST /internal/webhook_endpoints',
  'GET /internal/merchants/:merchantId/webhook_endpoints',
  'POST /internal/webhook_endpoints/:id/rotate_secret',
  'POST /internal/webhook_deliveries/:id/redeliver',
  'GET /console',
  'GET /console/payments',
  'GET /console/deliveries',
  'GET /console/keys',
  'POST /console/deliveries/:id/redeliver',
  'POST /webhooks/blockradar',
  'POST /webhooks/helius',
  'GET /test-dashboard',
  'POST /test-dashboard/merchants',
  'POST /test-dashboard/merchants/:id/kyb',
];

interface DiscoveredRoute {
  route: string;
  allowsEntry: boolean;
  guards: unknown[];
}

function joinPath(...parts: (string | undefined)[]): string {
  const joined = parts
    .filter((part): part is string => !!part && part !== '/')
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part.length > 0)
    .join('/');
  return `/${joined}`;
}

function asPaths(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  return [typeof value === 'string' ? value : ''];
}

async function discoverRoutes(): Promise<DiscoveredRoute[]> {
  applyAppModuleTestEnv();
  const { AppModule } =
    jest.requireActual<typeof import('../app.module')>('../app.module');

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, DiscoveryModule],
  })
    .overrideProvider(REDIS_CLIENT)
    .useValue({ quit: jest.fn().mockResolvedValue('OK') })
    .compile();

  const discovery = moduleRef.get(DiscoveryService);
  const reflector = moduleRef.get(Reflector);
  const routes: DiscoveredRoute[] = [];

  for (const wrapper of discovery.getControllers()) {
    const controller = wrapper.metatype as (new (...args: never[]) => unknown) &
      Record<string, unknown>;
    if (!controller) continue;
    const prototype = controller.prototype as Record<string, unknown>;
    const classGuards = (Reflect.getMetadata(GUARDS_METADATA, controller) ??
      []) as unknown[];

    for (const prefix of asPaths(
      Reflect.getMetadata(PATH_METADATA, controller),
    )) {
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (typeof handler !== 'function' || name === 'constructor') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          | RequestMethod
          | undefined;
        if (method === undefined) continue;

        const methodGuards = (Reflect.getMetadata(GUARDS_METADATA, handler) ??
          []) as unknown[];
        const allowsEntry =
          reflector.getAllAndOverride<boolean>(ALLOW_ENTRY, [
            handler as (...args: unknown[]) => unknown,
            controller,
          ]) === true;

        for (const path of asPaths(
          Reflect.getMetadata(PATH_METADATA, handler),
        )) {
          routes.push({
            route: `${RequestMethod[method]} ${joinPath(prefix, path)}`,
            allowsEntry,
            guards: [...classGuards, ...methodGuards],
          });
        }
      }
    }
  }
  return routes;
}

describe('entry session route inventory', () => {
  let routes: DiscoveredRoute[];

  beforeAll(async () => {
    routes = await discoverRoutes();
  });

  it('places every route in exactly one of the two lists', () => {
    const discovered = routes.map((r) => r.route).sort();
    const decided = [...ENTRY_ALLOWED, ...CLOSED_TO_ENTRY].sort();

    const overlap = ENTRY_ALLOWED.filter((r) => CLOSED_TO_ENTRY.includes(r));
    expect(overlap).toEqual([]);
    expect(new Set(decided).size).toBe(decided.length);
    // A route in neither list is one nobody decided about. Put it in
    // CLOSED_TO_ENTRY unless it is read-only or starts a recovery, and never
    // in ENTRY_ALLOWED if it can spend, change a signer or enrol anything.
    expect(discovered).toEqual(decided);
  });

  it('opens to entry exactly the routes in the allow list', () => {
    const open = routes
      .filter((r) => r.allowsEntry)
      .map((r) => r.route)
      .sort();
    expect(open).toEqual([...ENTRY_ALLOWED].sort());
  });

  it('closes to entry every route in the closed list', () => {
    const wronglyOpen = routes
      .filter((r) => CLOSED_TO_ENTRY.includes(r.route) && r.allowsEntry)
      .map((r) => r.route);
    expect(wronglyOpen).toEqual([]);
  });

  it('puts the tier-aware guard on every route that is open to entry', () => {
    // A route marked open but guarded by something that cannot read an entry
    // token would be closed by accident, which is the wrong way to be closed.
    const unguarded = routes
      .filter((r) => r.allowsEntry && !r.guards.includes(ConsumerAuthGuard))
      .map((r) => r.route);
    expect(unguarded).toEqual([]);
  });

  it('leaves no Consumer route on the raw JWT guard', () => {
    // The raw guard stamps no tier and understands no entry token, so a route
    // behind it is closed to entry only by accident and open to a principal
    // the tier check never saw. One guard, so there is one place to be wrong.
    const raw = routes
      .filter((r) => r.guards.includes(AuthGuard('jwt')))
      .map((r) => r.route);
    expect(raw).toEqual([]);
  });

  it('closes each route the capability table names, by name', () => {
    const mustBeClosed = [
      'POST /transfers/prepare',
      'POST /transfers/submit',
      'POST /payments/pending/:reference/prepare',
      'POST /payments/pending/:reference/submit',
      'POST /auth/passkey-credentials',
      'POST /auth/email/challenge',
      'POST /auth/email',
      'POST /account/recovery/email/challenge',
      'POST /account/recovery/email/verify',
      'POST /account/recovery/email',
      'POST /account/recovery/external-wallet',
      'POST /account/recovery/:id/remove',
      'POST /account/recovery/change/next',
      'POST /account/recovery/change/submit',
      'POST /account/changes/reject/prepare',
      'POST /account/changes/reject/submit',
      'POST /account/enrolment',
      'PUT /notifications/preferences',
      'DELETE /wallet/me',
    ];
    for (const route of mustBeClosed) {
      const found = routes.find((r) => r.route === route);
      expect(found).toBeDefined();
      expect(found?.allowsEntry).toBe(false);
    }
  });
});
