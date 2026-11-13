import { Controller, Get, Headers, Query } from '@nestjs/common';
import { MerchantAuditService } from './merchant-audit.service';
import { MerchantOwnerService } from './merchant-owner.service';

/**
 * The owner-visible audit trail. Scoped to the authenticated Merchant, so an
 * owner reads only their own sensitive-write history and never the operator
 * trail in admin_audit_log.
 */
@Controller('merchant-portal/audit')
export class MerchantPortalAuditController {
  constructor(
    private readonly owner: MerchantOwnerService,
    private readonly audit: MerchantAuditService,
  ) {}

  @Get()
  async list(
    @Headers('authorization') authorization: string | undefined,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const merchant = await this.owner.owned(authorization);
    const parsed = Number.parseInt(limit ?? '', 10);
    const take =
      Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 25;
    return this.audit.list(merchant.id, { limit: take, cursor });
  }
}
