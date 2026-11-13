import type { NextFunction, Request, Response } from 'express';
import { securityHeadersMiddleware } from './security-headers.middleware';

function run(hsts: boolean) {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as Response;
  const next = jest.fn();
  securityHeadersMiddleware({ hsts })({} as Request, res, next as NextFunction);
  return { headers, next };
}

describe('securityHeadersMiddleware', () => {
  it('always sets the sniffing, referrer and framing headers and calls next', () => {
    const { headers, next } = run(false);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('omits HSTS without TLS and sets it with TLS', () => {
    expect(run(false).headers['Strict-Transport-Security']).toBeUndefined();
    expect(run(true).headers['Strict-Transport-Security']).toContain(
      'max-age=31536000',
    );
  });

  it('never sets a Content-Security-Policy that could fight the checkout framing', () => {
    expect(run(true).headers['Content-Security-Policy']).toBeUndefined();
  });
});
