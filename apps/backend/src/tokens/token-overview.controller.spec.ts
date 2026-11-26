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
import { TokenOverviewController } from './token-overview.controller';
import { TokenOverviewService } from './token-overview.service';

const SOL = 'So11111111111111111111111111111111111111112';

describe('TokenOverviewController', () => {
  let app: INestApplication;
  const tokens = { overview: jest.fn() };

  beforeEach(async () => {
    jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockImplementation(authenticatePasskeySession);
    tokens.overview.mockReset().mockResolvedValue({ mint: SOL, points: [] });
    const module = await Test.createTestingModule({
      controllers: [TokenOverviewController],
      providers: [
        { provide: TokenOverviewService, useValue: tokens },
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

  const get = (path: string, session = fullSession('bob')) =>
    request(app.getHttpServer() as Server)
      .get(path)
      .set('Authorization', session);

  it('returns the overview for the mint and range', async () => {
    const res = await get(`/tokens/${SOL}/overview?range=1w`).expect(200);
    expect(res.body).toEqual({ mint: SOL, points: [] });
    expect(tokens.overview).toHaveBeenCalledWith(SOL, '1w');
  });

  it('defaults to one day', async () => {
    await get(`/tokens/${SOL}/overview`).expect(200);
    expect(tokens.overview).toHaveBeenCalledWith(SOL, '1d');
  });

  it.each(['1d', '1w', '1m', '6m', '1y'])('accepts %s', async (range) => {
    await get(`/tokens/${SOL}/overview?range=${range}`).expect(200);
    expect(tokens.overview).toHaveBeenCalledWith(SOL, range);
  });

  it.each([
    `/tokens/${SOL}/overview?range=5y`,
    `/tokens/${SOL}/overview?range=1d&extra=1`,
    '/tokens/not-a-mint/overview',
    '/tokens/So11111111111111111111111111111111111111110OIl/overview',
    '/tokens/abc/overview',
  ])('rejects %s', async (path) => {
    await get(path).expect(400);
    expect(tokens.overview).not.toHaveBeenCalled();
  });

  it('is open to an entry session', async () => {
    await get(`/tokens/${SOL}/overview`, entrySession('bob')).expect(200);
  });

  it('refuses an unauthenticated request', async () => {
    await request(app.getHttpServer() as Server)
      .get(`/tokens/${SOL}/overview`)
      .expect(401);
  });
});
