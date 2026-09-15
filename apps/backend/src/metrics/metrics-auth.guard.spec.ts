import {
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { MetricsAuthGuard } from './metrics-auth.guard';

function makeGuard(env: Record<string, string | undefined>) {
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  return new MetricsAuthGuard(config);
}

function ctx(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: authorization ? { authorization } : {} }),
    }),
  } as unknown as ExecutionContext;
}

describe('MetricsAuthGuard', () => {
  it('refuses the route outright in production when no secret is set', () => {
    const guard = makeGuard({ NODE_ENV: 'production' });
    expect(() => guard.canActivate(ctx())).toThrow(NotFoundException);
  });

  it('is open outside production when no secret is set', () => {
    const guard = makeGuard({ NODE_ENV: 'development' });
    expect(guard.canActivate(ctx())).toBe(true);
  });

  it('requires the bearer token once a secret is set, in every environment', () => {
    const guard = makeGuard({ NODE_ENV: 'development', METRICS_SECRET: 's3' });
    expect(() => guard.canActivate(ctx())).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx('Bearer nope'))).toThrow(
      UnauthorizedException,
    );
    expect(guard.canActivate(ctx('Bearer s3'))).toBe(true);
  });
});
