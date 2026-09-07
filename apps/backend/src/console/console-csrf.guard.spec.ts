import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  ConsoleCsrfGuard,
  CSRF_COOKIE,
  CSRF_FIELD,
  csrfField,
} from './console-csrf.guard';

const config = {
  get: (k: string) => (k === 'NODE_ENV' ? 'test' : undefined),
} as unknown as ConfigService;

function makeContext(opts: {
  method: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}) {
  const cookie = jest.fn();
  const locals: Record<string, unknown> = {};
  const req = {
    method: opts.method,
    headers: { host: 'ops.xend.global', ...(opts.headers ?? {}) },
    body: opts.body ?? {},
  };
  const res = { cookie, locals };
  const context = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { context, cookie, locals };
}

describe('ConsoleCsrfGuard', () => {
  it('sets a token cookie on a GET when none exists and exposes it to the view', () => {
    const { context, cookie, locals } = makeContext({ method: 'GET' });
    expect(new ConsoleCsrfGuard(config).canActivate(context)).toBe(true);
    expect(cookie).toHaveBeenCalledWith(
      CSRF_COOKIE,
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'strict' }),
    );
    expect(locals.csrfToken).toBe((cookie.mock.calls[0] as string[])[1]);
  });

  it('reuses an existing cookie on a GET without setting a new one', () => {
    const { context, cookie, locals } = makeContext({
      method: 'GET',
      headers: { cookie: `${CSRF_COOKIE}=abc123` },
    });
    new ConsoleCsrfGuard(config).canActivate(context);
    expect(cookie).not.toHaveBeenCalled();
    expect(locals.csrfToken).toBe('abc123');
  });

  it('accepts a same-origin POST whose form field matches the cookie', () => {
    const { context } = makeContext({
      method: 'POST',
      headers: {
        origin: 'https://ops.xend.global',
        cookie: `${CSRF_COOKIE}=abc123`,
      },
      body: { [CSRF_FIELD]: 'abc123' },
    });
    expect(new ConsoleCsrfGuard(config).canActivate(context)).toBe(true);
  });

  it('falls back to the Referer when Origin is absent', () => {
    const { context } = makeContext({
      method: 'POST',
      headers: {
        referer: 'https://ops.xend.global/console/accounts',
        cookie: `${CSRF_COOKIE}=abc123`,
      },
      body: { [CSRF_FIELD]: 'abc123' },
    });
    expect(new ConsoleCsrfGuard(config).canActivate(context)).toBe(true);
  });

  it('refuses a cross-origin POST even with a valid token', () => {
    const { context } = makeContext({
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        cookie: `${CSRF_COOKIE}=abc123`,
      },
      body: { [CSRF_FIELD]: 'abc123' },
    });
    expect(() => new ConsoleCsrfGuard(config).canActivate(context)).toThrow(
      ForbiddenException,
    );
  });

  it('refuses a POST with neither Origin nor Referer', () => {
    const { context } = makeContext({
      method: 'POST',
      headers: { cookie: `${CSRF_COOKIE}=abc123` },
      body: { [CSRF_FIELD]: 'abc123' },
    });
    expect(() => new ConsoleCsrfGuard(config).canActivate(context)).toThrow(
      ForbiddenException,
    );
  });

  it('refuses a same-origin POST whose token does not match the cookie', () => {
    const { context } = makeContext({
      method: 'POST',
      headers: {
        origin: 'https://ops.xend.global',
        cookie: `${CSRF_COOKIE}=abc123`,
      },
      body: { [CSRF_FIELD]: 'zzz999' },
    });
    expect(() => new ConsoleCsrfGuard(config).canActivate(context)).toThrow(
      ForbiddenException,
    );
  });

  it('refuses a same-origin POST with no cookie at all', () => {
    const { context } = makeContext({
      method: 'POST',
      headers: { origin: 'https://ops.xend.global' },
      body: { [CSRF_FIELD]: 'abc123' },
    });
    expect(() => new ConsoleCsrfGuard(config).canActivate(context)).toThrow(
      ForbiddenException,
    );
  });

  it('renders the hidden field with the token', () => {
    expect(csrfField('tok')).toBe(
      `<input type="hidden" name="${CSRF_FIELD}" value="tok">`,
    );
  });
});
