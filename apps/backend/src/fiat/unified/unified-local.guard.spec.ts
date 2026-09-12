import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '../../db/db.service';
import {
  UnifiedLocalGuard,
  LOCAL_SIMULATION_OWNER,
} from './unified-local.guard';

describe('local simulator access', () => {
  function fixture(environment = 'development', flag = 'true', overrides = {}) {
    const insert = jest.fn().mockReturnValue({
      values: () => ({ onConflictDoNothing: () => Promise.resolve(undefined) }),
    });
    const guard = new UnifiedLocalGuard(
      {
        get: (key: string) => (key === 'NODE_ENV' ? environment : flag),
      } as ConfigService,
      { client: { insert } } as unknown as DbService,
    );
    const req = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: 'localhost:8008', 'x-xend-local-simulation': '1' },
      user: undefined,
      ...overrides,
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as ExecutionContext;
    return { guard, req, context, insert };
  }
  it('assigns only the fixed demo owner to an explicit local request', async () => {
    const f = fixture();
    await expect(f.guard.canActivate(f.context)).resolves.toBe(true);
    expect(f.req.user).toEqual({ userId: LOCAL_SIMULATION_OWNER });
  });
  it.each([
    ['production', 'true', {}],
    ['test', 'true', {}],
    ['development', 'false', {}],
    ['development', 'true', { socket: { remoteAddress: '10.0.0.2' } }],
    [
      'development',
      'true',
      { headers: { host: 'public.example', 'x-xend-local-simulation': '1' } },
    ],
    ['development', 'true', { headers: { host: 'localhost:8008' } }],
    [
      'development',
      'true',
      {
        headers: {
          host: 'localhost:8008',
          'x-xend-local-simulation': '1',
          'x-forwarded-for': '10.0.0.2',
        },
      },
    ],
    [
      'development',
      'true',
      {
        headers: {
          host: 'localhost:8008',
          'x-xend-local-simulation': '1',
          origin: 'https://example.com',
        },
      },
    ],
  ])('rejects nonlocal or disabled access %#', async (env, flag, overrides) => {
    const f = fixture(env, flag, overrides);
    await expect(f.guard.canActivate(f.context)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(f.insert).not.toHaveBeenCalled();
  });
});
