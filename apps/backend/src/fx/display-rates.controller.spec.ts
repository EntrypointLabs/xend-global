import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { DisplayRatesController } from './display-rates.controller';
import {
  type DisplayRates,
  DisplayRatesService,
} from './display-rates.service';
import { FX_QUOTE_PROVIDER } from './fx-quote-provider.interface';

const LIVE = process.env.DISPLAY_RATES_LIVE === '1';

describe('GET /fx/display-rates', () => {
  let app: INestApplication;
  const realFetch = global.fetch;

  beforeEach(async () => {
    if (!LIVE) {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ rates: { GBP: 0.758 } }),
      }) as unknown as typeof fetch;
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [DisplayRatesController],
      providers: [
        DisplayRatesService,
        {
          provide: FX_QUOTE_PROVIDER,
          useValue: {
            getQuote: () =>
              Promise.resolve({
                ngnPerUsdc: '1530.25',
                source: 'test',
                quotedAt: new Date(),
              }),
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    global.fetch = realFetch;
    await app.close();
  });

  it('answers without a session, with dollar-based rates', async () => {
    const res = await request(app.getHttpServer() as Server)
      .get('/fx/display-rates')
      .expect(200);

    const body = res.body as DisplayRates;
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(body.perUsd.USD).toBe(1);
    expect(body.perUsd.NGN).toBe(1530.25);
    expect(body.perUsd.GBP).toBeGreaterThan(0.4);
    expect(body.perUsd.GBP).toBeLessThan(1.2);
    expect(Number.isNaN(Date.parse(body.quotedAt))).toBe(false);
  });
});
