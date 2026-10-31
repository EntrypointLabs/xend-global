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
import { FeedbackController } from './feedback.controller';
import { FeedbackRateLimitedError } from './feedback.errors';
import { FeedbackService } from './feedback.service';

const BODY = { message: 'The new home screen is much clearer.' };

describe('FeedbackController', () => {
  let app: INestApplication;
  const feedback = { create: jest.fn() };

  beforeEach(async () => {
    jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockImplementation(authenticatePasskeySession);
    feedback.create.mockReset().mockResolvedValue({ id: 'fb_1' });

    const module = await Test.createTestingModule({
      controllers: [FeedbackController],
      providers: [
        { provide: FeedbackService, useValue: feedback },
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
      .post('/feedback')
      .set('Authorization', session)
      .send(body);

  it('stores feedback for the authenticated Consumer, in exactly the agreed shape', async () => {
    const res = await post(
      { ...BODY, rating: 5, appVersion: '1.4.0', platform: 'ios' },
      fullSession('bob'),
    ).expect(201);

    expect(res.body).toEqual({ id: 'fb_1' });
    expect(feedback.create).toHaveBeenCalledWith('bob', {
      message: 'The new home screen is much clearer.',
      rating: 5,
      appVersion: '1.4.0',
      platform: 'ios',
    });
  });

  it('takes feedback with no rating', async () => {
    await post().expect(201);

    expect(feedback.create).toHaveBeenCalledWith('alice', BODY);
  });

  it('trims the message before it is measured or stored', async () => {
    await post({ message: `\n ${'a'.repeat(4000)}  ` }).expect(201);

    expect(feedback.create).toHaveBeenCalledWith('alice', {
      message: 'a'.repeat(4000),
    });
  });

  it('is closed to an entry session, with the code the app can tell apart', async () => {
    const res = await post(BODY, entrySession()).expect(403);

    expect(res.body).toMatchObject({ code: 'ENTRY_SESSION_FORBIDDEN' });
    expect(feedback.create).not.toHaveBeenCalled();
  });

  it('refuses feedback with no session at all', async () => {
    await request(app.getHttpServer() as Server)
      .post('/feedback')
      .send(BODY)
      .expect(401);

    expect(feedback.create).not.toHaveBeenCalled();
  });

  it.each([
    ['no message', {}],
    ['a message of nothing but spaces', { message: ' \n ' }],
    ['a message over 4000 characters', { message: 'a'.repeat(4001) }],
    ['a rating of zero', { ...BODY, rating: 0 }],
    ['a rating of six', { ...BODY, rating: 6 }],
    ['a rating that is not whole', { ...BODY, rating: 4.5 }],
    ['a rating sent as text', { ...BODY, rating: '4' }],
    [
      'an app version over 40 characters',
      { ...BODY, appVersion: '1'.repeat(41) },
    ],
    ['a platform that is neither', { ...BODY, platform: 'web' }],
  ])('rejects %s before it reaches the service', async (_label, body) => {
    const res = await post(body).expect(400);

    expect(res.body).toMatchObject({ message: 'Validation failed' });
    expect(feedback.create).not.toHaveBeenCalled();
  });

  it.each([1, 5])('takes a rating of %d', async (rating) => {
    await post({ ...BODY, rating }).expect(201);
  });

  it('answers 429 with its own code once the Consumer is over the limit', async () => {
    feedback.create.mockRejectedValue(new FeedbackRateLimitedError());

    const res = await post().expect(429);

    expect(res.body).toEqual({
      code: 'FEEDBACK_RATE_LIMITED',
      message: 'Thank you, we have your feedback. You can send more tomorrow.',
    });
  });
});
