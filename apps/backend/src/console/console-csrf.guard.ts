import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const CSRF_COOKIE = 'xend_console_csrf';
export const CSRF_FIELD = '_csrf';
const TOKEN_BYTES = 32;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for the console's form posts, which ride on Basic Auth
 * credentials the browser attaches to any request it is tricked into making.
 *
 * Two independent checks, both required on a state-changing request:
 * - the Origin header (Referer when a browser omits Origin) must name this
 *   host, so a cross-site form post is refused before any body is read;
 * - a double-submit token: a random value set in a cookie on every safe
 *   request and echoed back in a hidden form field. A cross-site page cannot
 *   read the cookie, so it cannot produce the field.
 *
 * The token is per browser session (the cookie has no expiry) and rotates
 * only when absent.
 */
@Injectable()
export class ConsoleCsrfGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const existing = readCookie(req, CSRF_COOKIE);

    if (SAFE_METHODS.has(req.method)) {
      const token = existing ?? randomBytes(TOKEN_BYTES).toString('base64url');
      if (!existing) {
        res.cookie(CSRF_COOKIE, token, {
          httpOnly: true,
          sameSite: 'strict',
          secure: this.config.get<string>('NODE_ENV') === 'production',
          path: '/console',
        });
      }
      res.locals.csrfToken = token;
      return true;
    }

    if (!this.sameOrigin(req)) {
      throw new ForbiddenException('cross-origin console request refused');
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const supplied = body[CSRF_FIELD];
    if (
      !existing ||
      typeof supplied !== 'string' ||
      supplied.length !== existing.length ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(existing))
    ) {
      throw new ForbiddenException('console CSRF token missing or invalid');
    }
    res.locals.csrfToken = existing;
    return true;
  }

  private sameOrigin(req: Request): boolean {
    const source = req.headers.origin ?? req.headers.referer;
    if (!source || Array.isArray(source)) return false;
    let host: string;
    try {
      host = new URL(source).host;
    } catch {
      return false;
    }
    return host === req.headers.host;
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/** The hidden input every console form must carry. */
export function csrfField(token: string): string {
  return `<input type="hidden" name="${CSRF_FIELD}" value="${token}">`;
}
