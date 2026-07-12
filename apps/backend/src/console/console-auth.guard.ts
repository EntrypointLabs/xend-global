import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * HTTP Basic Auth for the internal ops console (ADR 0022) — the backend's
 * first internal/admin auth boundary. This is disposable pilot tooling, not
 * the merchant-facing self-serve portal.
 *
 * Fail-safe: when either CONSOLE_USER or CONSOLE_PASSWORD is unset or empty
 * the console does not exist and every request is denied. Credentials are
 * compared with timingSafeEqual over SHA-256 digests so the comparison is
 * constant-time and never throws on a length mismatch. A 401 carries a
 * WWW-Authenticate challenge so the browser's native prompt is the entire
 * login UI (no login page, no session cookie — scale tooling for one
 * operator, deferred until the console grows write surface).
 */
@Injectable()
export class ConsoleAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const expectedUser = this.config.get<string>('CONSOLE_USER') ?? '';
    const expectedPassword = this.config.get<string>('CONSOLE_PASSWORD') ?? '';
    if (!expectedUser || !expectedPassword) {
      throw this.challenge(res);
    }

    const header = req.headers.authorization ?? '';
    const [scheme, encoded] = header.split(' ');
    if (scheme !== 'Basic' || !encoded) {
      throw this.challenge(res);
    }

    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const separator = decoded.indexOf(':');
    if (separator === -1) {
      throw this.challenge(res);
    }
    const suppliedUser = decoded.slice(0, separator);
    const suppliedPassword = decoded.slice(separator + 1);

    if (
      this.matches(suppliedUser, expectedUser) &&
      this.matches(suppliedPassword, expectedPassword)
    ) {
      return true;
    }
    throw this.challenge(res);
  }

  /** Constant-time compare over equal-length SHA-256 digests. */
  private matches(supplied: string, expected: string): boolean {
    const a = createHash('sha256').update(supplied).digest();
    const b = createHash('sha256').update(expected).digest();
    return timingSafeEqual(a, b);
  }

  private challenge(res: Response): UnauthorizedException {
    res.setHeader('WWW-Authenticate', 'Basic realm="Xend Console"');
    return new UnauthorizedException('Console authentication required');
  }
}
