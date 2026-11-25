import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import {
  authenticatePasskeySession,
  consumerSessionProviders,
  fullSession,
} from '../auth/consumer-session.test-fixtures';
import { EarnController } from './earn.controller';
import { EarnService } from './earn.service';

describe('EarnController history', () => {
  let app: INestApplication;
  const earn = { history: jest.fn() };

  beforeEach(async () => {
    jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockImplementation(authenticatePasskeySession);
    earn.history.mockReset().mockResolvedValue({
      provider: 'jupiter',
      points: [
        { day: '2026-11-25', valueMinor: '15030000', earnedMinor: '30000' },
      ],
    });
    const module = await Test.createTestingModule({
      controllers: [EarnController],
      providers: [
        { provide: EarnService, useValue: earn },
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

  const get = (query: string, session = fullSession('bob')) =>
    request(app.getHttpServer() as Server)
      .get(`/earn/history${query}`)
      .set('Authorization', session);

  it('returns the history of the authenticated Consumer', async () => {
    const res = await get('?provider=jupiter&range=7d').expect(200);
    expect(res.body).toEqual({
      provider: 'jupiter',
      points: [
        { day: '2026-11-25', valueMinor: '15030000', earnedMinor: '30000' },
      ],
    });
    expect(earn.history).toHaveBeenCalledWith('bob', 'jupiter', '7d');
  });

  it.each(['30d', '1y', 'all'])('accepts the %s range', async (range) => {
    await get(`?provider=kamino&range=${range}`).expect(200);
    expect(earn.history).toHaveBeenCalledWith('bob', 'kamino', range);
  });

  it.each([
    '?range=7d',
    '?provider=solend&range=7d',
    '?provider=kamino&range=90d',
    '?provider=kamino&range=7d&userId=alice',
  ])('rejects %s', async (query) => {
    await get(query).expect(400);
    expect(earn.history).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated request', async () => {
    await request(app.getHttpServer() as Server)
      .get('/earn/history?provider=kamino&range=7d')
      .expect(401);
  });
});
