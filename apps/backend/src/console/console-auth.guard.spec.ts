import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AdminAuditService } from './admin-audit.service';
import { ConsoleAuthGuard } from './console-auth.guard';

const USER = 'operator';
const PASSWORD = 's3cret';

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

function makeContext(authorization?: string): {
  context: ExecutionContext;
  setHeader: jest.Mock;
} {
  const setHeader = jest.fn();
  const req = { headers: authorization ? { authorization } : {} };
  const res = { setHeader };
  const context = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
  return { context, setHeader };
}

function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

describe('ConsoleAuthGuard', () => {
  it('denies with a WWW-Authenticate challenge when no header is present', () => {
    const guard = new ConsoleAuthGuard(
      makeConfig({ CONSOLE_USER: USER, CONSOLE_PASSWORD: PASSWORD }),
    );
    const { context, setHeader } = makeContext();
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Basic realm="Xend Console"',
    );
  });

  it('denies a wrong password', () => {
    const guard = new ConsoleAuthGuard(
      makeConfig({ CONSOLE_USER: USER, CONSOLE_PASSWORD: PASSWORD }),
    );
    const { context } = makeContext(basic(USER, 'wrong'));
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('records a wrong password on the audit trail, off the request path', async () => {
    const authFailed = jest.fn().mockResolvedValue(undefined);
    const guard = new ConsoleAuthGuard(
      makeConfig({ CONSOLE_USER: USER, CONSOLE_PASSWORD: PASSWORD }),
      { authFailed } as unknown as AdminAuditService,
    );
    const { context } = makeContext(basic(USER, 'wrong'));
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    await Promise.resolve();
    expect(authFailed).toHaveBeenCalledWith('console', 'unknown');
  });

  it('does not audit a request that carried no credentials at all', () => {
    const authFailed = jest.fn().mockResolvedValue(undefined);
    const guard = new ConsoleAuthGuard(
      makeConfig({ CONSOLE_USER: USER, CONSOLE_PASSWORD: PASSWORD }),
      { authFailed } as unknown as AdminAuditService,
    );
    const { context } = makeContext();
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(authFailed).not.toHaveBeenCalled();
  });

  it('allows correct credentials', () => {
    const guard = new ConsoleAuthGuard(
      makeConfig({ CONSOLE_USER: USER, CONSOLE_PASSWORD: PASSWORD }),
    );
    const { context } = makeContext(basic(USER, PASSWORD));
    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies every request when the console env is unset, even with a correct-looking header', () => {
    const guard = new ConsoleAuthGuard(
      makeConfig({ CONSOLE_USER: '', CONSOLE_PASSWORD: '' }),
    );
    const { context, setHeader } = makeContext(basic(USER, PASSWORD));
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Basic realm="Xend Console"',
    );
  });
});
