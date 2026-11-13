import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import {
  authenticatePasskeySession,
  consumerSessionProviders,
  entrySession,
  fullSession,
} from '../auth/consumer-session.test-fixtures';
import { SupportController } from './support.controller';
import { SupportRateLimitedError } from './support.errors';
import { SupportService } from './support.service';

const CREATED = { id: 'sr_1', replyTo: 'alice@example.com' };
const BODY = { topic: 'account_access', message: 'I cannot sign in.' };

describe('SupportController', () => {
  let app: INestApplication;
  const support = { create: jest.fn() };

  beforeEach(async () => {
    jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockImplementation(authenticatePasskeySession);
    support.create.mockReset().mockResolvedValue(CREATED);

    const module = await Test.createTestingModule({
      controllers: [SupportController],
      providers: [
        { provide: SupportService, useValue: support },
        ...consumerSessionProviders(),
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });

  const post = (body: object = BODY, session = fullSession()) =>
    request(app.getHttpServer() as Server)
      .post('/support/requests')
      .set('Authorization', session)
      .send(body);

  it('stores a request for the authenticated Consumer, in exactly the agreed shape', async () => {
    const res = await post(
      {
        topic: 'payments',
        message: 'A payment did not arrive.',
        appVersion: '1.4.0',
        platform: 'android',
      },
      fullSession('bob'),
    ).expect(201);

    expect(res.body).toEqual(CREATED);
    expect(support.create).toHaveBeenCalledWith('bob', {
      topic: 'payments',
      message: 'A payment did not arrive.',
      appVersion: '1.4.0',
      platform: 'android',
    });
  });

  it('answers null for the reply address when the Account has none', async () => {
    support.create.mockResolvedValue({ id: 'sr_2', replyTo: null });

    const res = await post().expect(201);

    expect(res.body).toEqual({ id: 'sr_2', replyTo: null });
  });

  it('is open to an entry session, which is all a locked-out Consumer has', async () => {
    await post(BODY, entrySession('carol')).expect(201);

    expect(support.create).toHaveBeenCalledWith('carol', BODY);
  });

  it('refuses a request with no session at all', async () => {
    await request(app.getHttpServer() as Server)
      .post('/support/requests')
      .send(BODY)
      .expect(401);

    expect(support.create).not.toHaveBeenCalled();
  });

  it('trims the message before it is measured or stored', async () => {
    await post({
      topic: 'other',
      message: `  ${'a'.repeat(4000)}\n\n`,
    }).expect(201);

    expect(support.create).toHaveBeenCalledWith('alice', {
      topic: 'other',
      message: 'a'.repeat(4000),
    });
  });

  it.each([
    ['no topic', { message: 'hello' }],
    ['a topic that is not one of ours', { topic: 'billing', message: 'hi' }],
    ['no message', { topic: 'other' }],
    ['a message of nothing but spaces', { topic: 'other', message: '   ' }],
    [
      'a message over 4000 characters',
      { topic: 'other', message: 'a'.repeat(4001) },
    ],
    [
      'an app version over 40 characters',
      { ...BODY, appVersion: '1'.repeat(41) },
    ],
    ['a platform that is neither', { ...BODY, platform: 'web' }],
  ])('rejects %s before it reaches the service', async (_label, body) => {
    const res = await post(body).expect(400);

    expect(res.body).toMatchObject({ message: 'Validation failed' });
    expect(support.create).not.toHaveBeenCalled();
  });

  it('answers 429 with its own code once the Consumer is over the limit', async () => {
    support.create.mockRejectedValue(new SupportRateLimitedError());

    const res = await post().expect(429);

    expect(res.body).toEqual({
      code: 'SUPPORT_RATE_LIMITED',
      message:
        'We have your recent requests and will reply to them. You can send another later.',
    });
  });

  it('says nothing of what went wrong when the failure is not one it knows', async () => {
    support.create.mockRejectedValue(
      new Error('relation "support_requests" does not exist'),
    );

    const res = await post().expect(500);

    expect(JSON.stringify(res.body)).not.toContain('support_requests');
  });
});
