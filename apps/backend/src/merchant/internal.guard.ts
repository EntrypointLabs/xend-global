import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { UnauthorizedInternalError } from './merchant.errors';

/**
 * Guards internal ops endpoints (webhook endpoint registration, manual
 * redelivery, refunds). Compares the x-internal-api-key header to
 * INTERNAL_API_SECRET with a length-guarded timing-safe compare. This keeps
 * ops surfaces off the merchant key and off the consumer JWT.
 */
@Injectable()
export class InternalGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-internal-api-key'];
    const secret = this.config.getOrThrow<string>('INTERNAL_API_SECRET');

    try {
      if (typeof provided !== 'string') {
        throw new UnauthorizedInternalError('missing internal api key');
      }
      const a = Buffer.from(provided);
      const b = Buffer.from(secret);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new UnauthorizedInternalError('invalid internal api key');
      }
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedInternalError) {
        throw new HttpException(
          { code: err.code, message: err.message },
          HttpStatus.UNAUTHORIZED,
        );
      }
      throw err as Error;
    }
  }
}
