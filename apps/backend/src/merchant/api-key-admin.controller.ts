import {
  Controller,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InternalGuard } from './internal.guard';
import { KeyIssuanceService } from './key-issuance.service';
import { ApiKeyNotFoundError } from './merchant.errors';

export interface RevokedKeyObject {
  id: string;
  object: 'api_key';
  merchant_id: string;
  fingerprint: string;
  mode: 'test' | 'live';
  revoked_at: string;
}

/**
 * Ops-initiated key lifecycle (InternalGuard). Issuance stays on the ops
 * script; this is the other half, so a leaked or retired key can be shut off
 * without a database session.
 */
@Controller('internal')
@UseGuards(InternalGuard)
export class ApiKeyAdminController {
  constructor(private readonly keys: KeyIssuanceService) {}

  @Post('api_keys/:id/revoke')
  async revoke(@Param('id') id: string): Promise<RevokedKeyObject> {
    try {
      const key = await this.keys.revokeKey(id);
      return {
        id: key.id,
        object: 'api_key',
        merchant_id: key.merchantId,
        fingerprint: key.fingerprint,
        mode: key.mode,
        revoked_at: key.revokedAt.toISOString(),
      };
    } catch (err) {
      if (err instanceof ApiKeyNotFoundError) {
        throw new HttpException(
          { code: err.code, message: err.message },
          HttpStatus.NOT_FOUND,
        );
      }
      throw err as Error;
    }
  }
}
