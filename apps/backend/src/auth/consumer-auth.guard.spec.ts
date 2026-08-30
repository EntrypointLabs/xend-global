import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { AllowEntry } from './allow-entry.decorator';
import { ConsumerAuthGuard } from './consumer-auth.guard';
import { EntrySessionInvalidError } from './entry-session.errors';
import type { EntrySessionService } from './entry-session.service';
import type { Principal } from './principal';

/**
 * The guard is where the tier is enforced, so what is pinned here is the
 * shape of the decision: an entry token reaches a route only when that route
 * said so, a full session is unaffected, and the refusal is the one the app
 * can tell apart from an expired session.
 */

const ENTRY_PRINCIPAL: Principal = {
  userId: 'user-1',
  walletAddress: 'wallet-1',
  tier: 'entry',
  entrySessionId: 'entry-1',
};

class OpenController {
  @AllowEntry()
  allowed() {}
  closed() {}
}

@AllowEntry()
class WholeController {
  anything() {}
}

function makeContext(
  authorization: string | undefined,
  cls: new () => unknown,
  method: string,
) {
  const handler = (cls.prototype as Record<string, unknown>)[method];
  const request: {
    headers: Record<string, string | undefined>;
    user?: unknown;
  } = { headers: { authorization } };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
    getHandler: () => handler,
    getClass: () => cls,
  } as unknown as ExecutionContext;
  return { context, request };
}

function makeGuard(jwtPrincipal: Principal | null) {
  const entrySessions = {
    authenticate: jest.fn((raw: string) =>
      raw === 'xentry_live'
        ? Promise.resolve(ENTRY_PRINCIPAL)
        : Promise.reject(
            new EntrySessionInvalidError('that session is not valid'),
          ),
    ),
  } as unknown as EntrySessionService;
  const guard = new ConsumerAuthGuard(new Reflector(), entrySessions);

  // The JWT half is passport's, exercised in the strategy's own spec. Here it
  // is stood in for at the boundary the guard actually calls.
  jest
    .spyOn(AuthGuard('jwt').prototype, 'canActivate')
    .mockImplementation((context: ExecutionContext) => {
      if (!jwtPrincipal) throw new UnauthorizedException();
      context.switchToHttp().getRequest<{ user?: Principal }>().user =
        jwtPrincipal;
      return Promise.resolve(true);
    });
  return guard;
}

afterEach(() => jest.restoreAllMocks());

describe('ConsumerAuthGuard', () => {
  const full: Principal = {
    userId: 'user-1',
    walletAddress: 'wallet-1',
    tier: 'full',
  };

  it('lets an entry token through a route marked for it', async () => {
    const guard = makeGuard(null);
    const { context, request } = makeContext(
      'Bearer xentry_live',
      OpenController,
      'allowed',
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(ENTRY_PRINCIPAL);
  });

  it('refuses an entry token on a route that said nothing, with its own code', async () => {
    const guard = makeGuard(null);
    const { context } = makeContext(
      'Bearer xentry_live',
      OpenController,
      'closed',
    );

    const refusal = guard.canActivate(context);
    await expect(refusal).rejects.toBeInstanceOf(ForbiddenException);
    await expect(refusal).rejects.toMatchObject({
      response: { code: 'ENTRY_SESSION_FORBIDDEN' },
    });
  });

  it('honours a mark on the whole controller', async () => {
    const guard = makeGuard(null);
    const { context } = makeContext(
      'Bearer xentry_live',
      WholeController,
      'anything',
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('answers a dead entry token with 401, not 403', async () => {
    const guard = makeGuard(null);
    const { context } = makeContext(
      'Bearer xentry_dead',
      OpenController,
      'allowed',
    );

    const refusal = guard.canActivate(context);
    await expect(refusal).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(refusal).rejects.toMatchObject({
      response: { code: 'ENTRY_SESSION_INVALID' },
    });
  });

  it('lets a full session through every route, marked or not', async () => {
    const guard = makeGuard(full);
    const open = makeContext('Bearer eyJ.jwt.sig', OpenController, 'allowed');
    const closed = makeContext('Bearer eyJ.jwt.sig', OpenController, 'closed');

    await expect(guard.canActivate(open.context)).resolves.toBe(true);
    await expect(guard.canActivate(closed.context)).resolves.toBe(true);
    expect(closed.request.user).toEqual(full);
  });

  it('never hands an entry token to the JWT strategy', async () => {
    const guard = makeGuard(full);
    const { context, request } = makeContext(
      'Bearer xentry_live',
      OpenController,
      'allowed',
    );

    await guard.canActivate(context);
    expect(request.user).toEqual(ENTRY_PRINCIPAL);
  });

  it('refuses a request with no credential at all', async () => {
    const guard = makeGuard(null);
    const { context } = makeContext(undefined, OpenController, 'allowed');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
