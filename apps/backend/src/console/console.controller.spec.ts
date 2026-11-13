import 'reflect-metadata';
import { Logger, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { DbService } from '../db/db.service';
import { RecoveryService } from '../recovery/recovery.service';
import { SupportService } from '../support/support.service';
import { WebhookDeliveryService } from '../webhook/webhook-delivery.service';
import { AdminAuditService } from './admin-audit.service';
import { CSRF_COOKIE, CSRF_FIELD } from './console-csrf.guard';
import { ConsoleController } from './console.controller';
import {
  ConsoleService,
  type ConsoleFeedbackRow,
  type ConsoleSupportRow,
} from './console.service';

const SETTINGS: Record<string, string> = {
  CONSOLE_USER: 'ops',
  CONSOLE_PASSWORD: 'correct horse',
  NODE_ENV: 'test',
};
const BASIC = `Basic ${Buffer.from('ops:correct horse').toString('base64')}`;
const HOST = 'console.test';

const SCRIPT = '<script>alert(1)</script>';
const ESCAPED_SCRIPT = '&lt;script&gt;alert(1)&lt;/script&gt;';

const OPEN_REQUEST: ConsoleSupportRow = {
  id: 'sr_open',
  createdAt: new Date('2027-03-02T10:00:00.000Z'),
  topic: 'account_access',
  status: 'open',
  closedAt: null,
  contactEmail: 'alice@example.com',
  message: 'I cannot sign in.\nIt says my passkey is not recognised.',
};
const CLOSED_REQUEST: ConsoleSupportRow = {
  id: 'sr_closed',
  createdAt: new Date('2027-03-01T09:00:00.000Z'),
  topic: 'payments',
  status: 'closed',
  closedAt: new Date('2027-03-01T12:00:00.000Z'),
  contactEmail: null,
  message: 'A payment did not arrive.',
};

/**
 * The console's support and feedback pages behind its real guards: Basic Auth
 * in front of every route, and the CSRF pair in front of the one write.
 */
describe('ConsoleController: support and feedback', () => {
  let app: INestApplication;
  const consoleService = {
    listSupportRequests: jest.fn<Promise<ConsoleSupportRow[]>, []>(),
    listFeedback: jest.fn<Promise<ConsoleFeedbackRow[]>, []>(),
  };
  const support = { close: jest.fn() };
  const audit = { record: jest.fn(), authFailed: jest.fn() };

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    consoleService.listSupportRequests
      .mockReset()
      .mockResolvedValue([OPEN_REQUEST, CLOSED_REQUEST]);
    consoleService.listFeedback.mockReset().mockResolvedValue([]);
    support.close.mockReset().mockResolvedValue('closed');
    audit.record.mockReset().mockResolvedValue(undefined);
    audit.authFailed.mockReset().mockResolvedValue(undefined);

    const module = await Test.createTestingModule({
      controllers: [ConsoleController],
      providers: [
        { provide: ConsoleService, useValue: consoleService },
        { provide: SupportService, useValue: support },
        { provide: AdminAuditService, useValue: audit },
        { provide: WebhookDeliveryService, useValue: {} },
        { provide: RecoveryService, useValue: {} },
        { provide: DbService, useValue: {} },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => SETTINGS[key] },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });

  const http = () => request(app.getHttpServer() as Server);
  const page = (path: string) =>
    http().get(path).set('Host', HOST).set('Authorization', BASIC);

  /** Loads a page the way a browser would, and keeps what a form post needs. */
  async function openSupportPage() {
    const res = await page('/console/support').expect(200);
    const cookies = res.get('Set-Cookie') ?? [];
    const cookie = cookies
      .map((c) => c.split(';')[0])
      .find((c) => c.startsWith(`${CSRF_COOKIE}=`));
    const token = new RegExp(`name="${CSRF_FIELD}" value="([^"]+)"`).exec(
      res.text,
    )?.[1];
    if (!cookie || !token) throw new Error('page carried no CSRF token');
    return { html: res.text, cookie, token };
  }

  const close = (id: string, form: { cookie: string; token?: string }) =>
    http()
      .post(`/console/support/${id}/close`)
      .set('Host', HOST)
      .set('Origin', `https://${HOST}`)
      .set('Authorization', BASIC)
      .set('Cookie', form.cookie)
      .type('form')
      .send(form.token ? { [CSRF_FIELD]: form.token } : {});

  describe('the nav', () => {
    it('links the two new pages beside the ones that were there', async () => {
      const { html } = await openSupportPage();

      for (const link of [
        '<a href="/console/payments">Payments</a>',
        '<a href="/console/accounts">Accounts</a>',
        '<a href="/console/support">Support</a>',
        '<a href="/console/feedback">Feedback</a>',
      ]) {
        expect(html).toContain(link);
      }
    });
  });

  describe('GET /console/support', () => {
    it('lists requests in the order it was given them, with when, topic, status, email and message', async () => {
      const { html } = await openSupportPage();

      expect(html).toContain('<title>Support · Prydd Console</title>');
      expect(html.indexOf('2027-03-02T10:00:00.000Z')).toBeLessThan(
        html.indexOf('2027-03-01T09:00:00.000Z'),
      );
      expect(html).toContain('<td>account_access</td>');
      expect(html).toContain('<td class="nowrap">Open</td>');
      expect(html).toContain('<td>alice@example.com</td>');
      expect(html).toContain(
        '<td class="prose"><div>I cannot sign in.\nIt says my passkey is not recognised.</div></td>',
      );
      expect(html).toContain(
        '<td class="nowrap">Closed 2027-03-01T12:00:00.000Z</td>',
      );
    });

    it('offers Close on an open request only, behind the CSRF token', async () => {
      const { html, token } = await openSupportPage();

      expect(html).toContain(
        `<form method="post" action="/console/support/sr_open/close"><input type="hidden" name="${CSRF_FIELD}" value="${token}"><button type="submit">Close</button></form>`,
      );
      expect(html).not.toContain('/console/support/sr_closed/close');
    });

    it('escapes everything the Consumer typed', async () => {
      consoleService.listSupportRequests.mockResolvedValue([
        {
          ...OPEN_REQUEST,
          message: `${SCRIPT} & "quoted"`,
          contactEmail: '"><img src=x onerror=alert(2)>@example.com',
        },
      ]);

      const { html } = await openSupportPage();

      expect(html).not.toContain('<script>');
      expect(html).not.toContain('<img');
      expect(html).toContain(`${ESCAPED_SCRIPT} &amp; &quot;quoted&quot;`);
      expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(2)&gt;');
    });

    it('says so when there are none', async () => {
      consoleService.listSupportRequests.mockResolvedValue([]);

      const res = await page('/console/support').expect(200);

      expect(res.text).toContain(
        '<p class="empty">No support requests yet.</p>',
      );
    });
  });

  describe('GET /console/feedback', () => {
    it('lists feedback with when, rating, message and email', async () => {
      consoleService.listFeedback.mockResolvedValue([
        {
          createdAt: new Date('2027-03-02T10:00:00.000Z'),
          rating: 4,
          message: 'The new home screen is clearer.',
          email: 'alice@example.com',
        },
        {
          createdAt: new Date('2027-03-01T09:00:00.000Z'),
          rating: null,
          message: 'Unrated.',
          email: null,
        },
      ]);

      const res = await page('/console/feedback').expect(200);

      expect(res.text).toContain('<title>Feedback · Prydd Console</title>');
      expect(res.text).toContain(
        '<td class="nowrap">2027-03-02T10:00:00.000Z</td><td>4 of 5</td>' +
          '<td class="prose"><div>The new home screen is clearer.</div></td>' +
          '<td>alice@example.com</td>',
      );
      const unrated = res.text
        .split('<tr>')
        .find((row) => row.includes('Unrated.'));
      expect(unrated).toContain('<td class="prose"><div>Unrated.</div></td>');
      expect(unrated).not.toContain('of 5');
      expect(unrated).not.toContain('null');
    });

    it('escapes the message', async () => {
      consoleService.listFeedback.mockResolvedValue([
        {
          createdAt: new Date('2027-03-02T10:00:00.000Z'),
          rating: 1,
          message: SCRIPT,
          email: null,
        },
      ]);

      const res = await page('/console/feedback').expect(200);

      expect(res.text).not.toContain('<script>');
      expect(res.text).toContain(ESCAPED_SCRIPT);
    });

    it('says so when there is none', async () => {
      const res = await page('/console/feedback').expect(200);

      expect(res.text).toContain('<p class="empty">No feedback yet.</p>');
    });
  });

  describe('POST /console/support/:id/close', () => {
    it('closes the request, records who did it, and returns to the list', async () => {
      const form = await openSupportPage();

      const res = await close('sr_open', form).expect(303);

      expect(res.headers.location).toBe('/console/support');
      expect(support.close).toHaveBeenCalledWith('sr_open');
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        'ops',
        'support.close',
        'sr_open',
      );
    });

    it('records nothing for a request that was already closed', async () => {
      support.close.mockResolvedValue('already_closed');
      const form = await openSupportPage();

      await close('sr_closed', form).expect(303);

      expect(audit.record).not.toHaveBeenCalled();
    });

    it('answers 404, and records nothing, for a request that does not exist', async () => {
      support.close.mockResolvedValue('not_found');
      const form = await openSupportPage();

      await close('sr_nobody', form).expect(404);

      expect(audit.record).not.toHaveBeenCalled();
    });

    it('refuses a post without the CSRF token before anything is closed', async () => {
      const { cookie } = await openSupportPage();

      await close('sr_open', { cookie }).expect(403);

      expect(support.close).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('refuses a post from another origin', async () => {
      const form = await openSupportPage();

      await close('sr_open', form)
        .set('Origin', 'https://elsewhere.test')
        .expect(403);

      expect(support.close).not.toHaveBeenCalled();
    });
  });

  describe('without the operator credentials', () => {
    it.each(['/console/support', '/console/feedback'])(
      'refuses GET %s',
      async (path) => {
        await http().get(path).set('Host', HOST).expect(401);
      },
    );

    it('refuses to close a request', async () => {
      await http()
        .post('/console/support/sr_open/close')
        .set('Host', HOST)
        .set('Origin', `https://${HOST}`)
        .type('form')
        .send({})
        .expect(401);

      expect(support.close).not.toHaveBeenCalled();
    });
  });
});
