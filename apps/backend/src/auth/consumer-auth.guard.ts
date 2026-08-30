import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { isObservable, lastValueFrom } from 'rxjs';

import { ALLOW_ENTRY } from './allow-entry.decorator';
import { EntrySessionInvalidError } from './entry-session.errors';
import { EntrySessionService } from './entry-session.service';
import type { Principal } from './principal';

/**
 * The one guard on every Consumer route.
 *
 * It accepts two credentials and stamps a tier on whichever it saw: a Xend
 * JWT from `auth/exchange` is `full`, an entry token is `entry`. Then it
 * enforces the tier. A route is closed to `entry` unless it carries
 * `@AllowEntry()`, so the decision a route's author did not make is the safe
 * one. The refusal is a 403 with its own code rather than a 401, because the
 * session is valid and the app must not throw it away over this.
 */
@Injectable()
export class ConsumerAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly entrySessions: EntrySessionService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: Principal }>();
    const raw = bearerToken(request);

    if (raw && EntrySessionService.isEntryToken(raw)) {
      try {
        request.user = await this.entrySessions.authenticate(raw);
      } catch (err) {
        if (err instanceof EntrySessionInvalidError) {
          throw new UnauthorizedException({
            code: err.code,
            message: err.message,
          });
        }
        throw err;
      }
    } else {
      const verdict = super.canActivate(context);
      const passed = isObservable(verdict)
        ? await lastValueFrom(verdict)
        : await verdict;
      if (!passed) throw new UnauthorizedException();
    }

    const principal = request.user;
    if (!principal) throw new UnauthorizedException();

    if (principal.tier === 'entry') {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_ENTRY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) {
        throw new ForbiddenException({
          code: 'ENTRY_SESSION_FORBIDDEN',
          message: 'sign in with your passkey to do that',
        });
      }
    }
    return true;
  }
}

function bearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}
