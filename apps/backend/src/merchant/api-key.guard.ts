import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { DbService } from '../db/db.service';
import { apiKeys, merchants } from '../db/schema';
import { hashApiKey, LIVE_PREFIX, TEST_PREFIX } from './api-key.util';
import { InvalidApiKeyError, MerchantSuspendedError } from './merchant.errors';

/** Attached to the request by ApiKeyGuard for the merchant API surface. */
export interface MerchantContext {
  merchantId: string;
  apiKeyId: string;
  mode: 'test' | 'live';
}

export interface MerchantRequest extends Request {
  merchant: MerchantContext;
}

/**
 * The merchant auth primitive: a plain CanActivate guard beside (not on top
 * of) the consumer JWT. It reads `Authorization: Bearer <key>` (falling back
 * to x-api-key), hashes the raw key, looks it up by SHA-256, and attaches
 * `request.merchant`. Raw keys are never compared or stored; only the hash
 * is. The guard is the HTTP boundary, so it maps its own typed errors to 401
 * / 403 here.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(private readonly db: DbService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<MerchantRequest>();
    try {
      const raw = this.extractKey(request);
      if (
        !raw ||
        (!raw.startsWith(TEST_PREFIX) && !raw.startsWith(LIVE_PREFIX))
      ) {
        throw new InvalidApiKeyError('missing or malformed api key');
      }

      const keyHash = hashApiKey(raw);
      const [keyRow] = await this.db.client
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.keyHash, keyHash))
        .limit(1);
      if (!keyRow || keyRow.revokedAt) {
        throw new InvalidApiKeyError('api key not found or revoked');
      }

      const [merchant] = await this.db.client
        .select()
        .from(merchants)
        .where(eq(merchants.id, keyRow.merchantId))
        .limit(1);
      if (!merchant) {
        throw new InvalidApiKeyError('api key not found or revoked');
      }
      if (merchant.status !== 'active') {
        throw new MerchantSuspendedError(`merchant is ${merchant.status}`);
      }

      request.merchant = {
        merchantId: keyRow.merchantId,
        apiKeyId: keyRow.id,
        mode: keyRow.mode,
      };

      // Fire-and-forget: last_used_at is telemetry, not correctness. Never
      // block the hot path on it and swallow only this non-critical write.
      void this.db.client
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, keyRow.id))
        .catch((err: unknown) =>
          this.logger.debug(
            `api_key.last_used_at update failed: ${String(err)}`,
          ),
        );

      return true;
    } catch (err) {
      if (err instanceof InvalidApiKeyError) {
        throw new HttpException(
          { code: err.code, message: err.message },
          HttpStatus.UNAUTHORIZED,
        );
      }
      if (err instanceof MerchantSuspendedError) {
        throw new HttpException(
          { code: err.code, message: err.message },
          HttpStatus.FORBIDDEN,
        );
      }
      throw err as Error;
    }
  }

  private extractKey(request: Request): string | undefined {
    const auth = request.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      return auth.slice('Bearer '.length).trim();
    }
    const apiKeyHeader = request.headers['x-api-key'];
    if (typeof apiKeyHeader === 'string' && apiKeyHeader.length > 0) {
      return apiKeyHeader.trim();
    }
    return undefined;
  }
}
