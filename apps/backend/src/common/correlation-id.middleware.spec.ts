import type { Request, Response } from 'express';
import { correlationIdMiddleware } from './correlation-id.middleware';
import { getCorrelationId } from './correlation-id.storage';

const ID_SHAPE = /^[A-Za-z0-9_-]{8,64}$/;

function makeReq(headers: Record<string, string> = {}): Request {
  return {
    method: 'GET',
    originalUrl: '/',
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

function makeRes(): Response & { headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    headers,
    statusCode: 200,
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    on: () => undefined,
  } as unknown as Response & { headers: Record<string, string> };
}

describe('correlationIdMiddleware', () => {
  it('mints a fresh cuid2 when no inbound header is present', () => {
    const res = makeRes();
    correlationIdMiddleware(makeReq(), res, () => {});
    expect(res.headers['X-Correlation-Id']).toMatch(ID_SHAPE);
  });

  it('echoes a valid inbound x-correlation-id unchanged', () => {
    const res = makeRes();
    correlationIdMiddleware(
      makeReq({ 'x-correlation-id': 'abc123DEF456' }),
      res,
      () => {},
    );
    expect(res.headers['X-Correlation-Id']).toBe('abc123DEF456');
  });

  it('replaces an invalid inbound value', () => {
    const res = makeRes();
    correlationIdMiddleware(
      makeReq({ 'x-correlation-id': '<script>' }),
      res,
      () => {},
    );
    expect(res.headers['X-Correlation-Id']).not.toBe('<script>');
    expect(res.headers['X-Correlation-Id']).toMatch(ID_SHAPE);
  });

  it('exposes the id via getCorrelationId inside next', () => {
    let seen: string | undefined;
    correlationIdMiddleware(
      makeReq({ 'x-correlation-id': 'validId12345' }),
      makeRes(),
      () => {
        seen = getCorrelationId();
      },
    );
    expect(seen).toBe('validId12345');
  });
});
