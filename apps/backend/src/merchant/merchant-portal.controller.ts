import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DbService } from '../db/db.service';
import {
  apiKeys,
  merchants,
  paymentIntents,
  settlementAccounts,
} from '../db/schema';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { KeyIssuanceService } from './key-issuance.service';
import { MerchantAuditService } from './merchant-audit.service';
import {
  MerchantOwnerService,
  type OwnedMerchant,
} from './merchant-owner.service';
import { SettlementProvisioningService } from '../settlement/settlement-provisioning.service';
import { SettlementAccountNotProvisionedError } from '../settlement/settlement.errors';
import { ApiKeyNotFoundError } from './merchant.errors';
import { devnetExecutionEnabled } from './devnet-execution';
import { MerchantProfileUpdate } from './profile.dtos';
import { toApiKeyView, toMerchantView } from './merchant-portal.view';

const Registration = z.object({
  name: z.string().trim().min(2).max(100),
  origin: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.origin === value &&
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' &&
            ['localhost', '127.0.0.1'].includes(url.hostname)))
      );
    }, 'Use an HTTPS origin, or localhost for development'),
  acceptUsdcTerms: z.literal(true),
});
const KeyRequest = z.object({
  mode: z.enum(['test', 'live', 'devnet']),
  name: z.string().trim().max(60).optional(),
});

/** Owner identity comes from a verified provider token, never a submitted id. */
@Controller('merchant-portal')
export class MerchantPortalController {
  constructor(
    private readonly db: DbService,
    private readonly owner: MerchantOwnerService,
    private readonly keys: KeyIssuanceService,
    private readonly provisioning: SettlementProvisioningService,
    private readonly config: ConfigService,
    private readonly audit: MerchantAuditService,
  ) {}

  @Post('profile')
  async updateProfile(
    @Headers('authorization') authorization: string | undefined,
    @Body(new ZodValidationPipe(MerchantProfileUpdate))
    body: z.infer<typeof MerchantProfileUpdate>,
  ) {
    const merchant = await this.owner.owned(authorization);
    if (
      merchant.kybStatus === 'verified' &&
      body.profile.legalName !== (merchant.businessProfile?.legalName ?? '')
    ) {
      throw new ConflictException(
        'Legal business name changes require verification review. Other contact details can be updated here.',
      );
    }
    const [updated] = await this.db.client
      .update(merchants)
      .set({
        displayName: body.displayName,
        businessProfile: body.profile,
        profileVersion: body.expectedVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(merchants.id, merchant.id),
          eq(merchants.profileVersion, body.expectedVersion),
          // A verification decision may land after the ownership read. Do not
          // save a legal-name edit under an obsolete pending-verification state.
          eq(merchants.kybStatus, merchant.kybStatus),
        ),
      )
      .returning();
    if (!updated)
      throw new ConflictException(
        'This profile changed in another session. Reload the latest profile before saving.',
      );
    await this.audit.record({
      merchantId: merchant.id,
      actor: merchant.ownerProviderId ?? 'unknown',
      action: 'profile.update',
      target: merchant.id,
      metadata: { version: String(updated.profileVersion) },
    });
    return this.dashboard({
      ...updated,
      signInEmail: merchant.signInEmail,
    });
  }

  @Post('register')
  async register(
    @Headers('authorization') authorization: string | undefined,
    @Body(new ZodValidationPipe(Registration))
    body: z.infer<typeof Registration>,
  ) {
    const identity = await this.owner.identity(authorization);
    // Concurrent signup requests resolve to the same Merchant. No client can
    // attach itself to a pre-existing Merchant by supplying an id or email.
    await this.db.client
      .insert(merchants)
      .values({
        ownerProviderId: identity.providerUserId,
        receivingWallet: identity.walletAddress,
        name: body.name,
        displayName: body.name,
        allowedOrigins: [body.origin],
        settlementTermsAcceptedAt: new Date(),
      })
      .onConflictDoNothing({ target: merchants.ownerProviderId });
    return this.dashboard(await this.owner.ownedForIdentity(identity));
  }

  @Get('me')
  async me(@Headers('authorization') authorization?: string) {
    const merchant = await this.owner.owned(authorization);
    return this.dashboard(merchant);
  }

  /**
   * Records that the owner is ready for verification review. A first
   * submission stamps the submitted time; a resubmission after a rejection
   * clears the rejection back to pending so the review can run again on the
   * corrected details. It never self-approves: only the off-system review
   * moves a Merchant to verified.
   */
  @Post('kyb/submit')
  async submitKyb(@Headers('authorization') authorization?: string) {
    const merchant = await this.owner.owned(authorization);
    if (merchant.kybStatus === 'verified')
      throw new ConflictException('Your business is already verified.');
    const now = new Date();
    const [updated] = await this.db.client
      .update(merchants)
      .set({
        kybStatus: 'pending',
        kybSubmittedAt: now,
        kybReviewNote: null,
        updatedAt: now,
      })
      .where(eq(merchants.id, merchant.id))
      .returning();
    await this.audit.record({
      merchantId: merchant.id,
      actor: merchant.ownerProviderId ?? 'unknown',
      action: 'kyb.submit',
      target: merchant.id,
    });
    return this.dashboard({
      ...(updated ?? merchant),
      signInEmail: merchant.signInEmail,
    });
  }

  private async dashboard(merchant: OwnedMerchant) {
    const [destination] = await this.db.client
      .select()
      .from(settlementAccounts)
      .where(eq(settlementAccounts.merchantId, merchant.id))
      .limit(1);
    const keys = await this.db.client
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.merchantId, merchant.id))
      .orderBy(desc(apiKeys.createdAt));
    const payments = await this.db.client
      .select({
        id: paymentIntents.id,
        status: paymentIntents.status,
        amountRaw: paymentIntents.usdcSettlementRaw,
        mode: paymentIntents.mode,
        createdAt: paymentIntents.createdAt,
      })
      .from(paymentIntents)
      .where(eq(paymentIntents.merchantId, merchant.id))
      .orderBy(desc(paymentIntents.createdAt))
      .limit(20);
    return {
      merchant: toMerchantView(merchant),
      destination: destination
        ? { address: destination.address, provider: destination.provider }
        : null,
      keys: keys.map(toApiKeyView),
      payments: payments.map((payment) => ({
        id: payment.id,
        status: payment.status,
        amountRaw: payment.amountRaw,
        mode: payment.mode,
        createdAt: payment.createdAt.toISOString(),
      })),
      cluster: this.config.getOrThrow<string>('SOLANA_CLUSTER'),
      devnetExecutionEnabled: devnetExecutionEnabled(this.config),
    };
  }

  @Post('destination')
  async provision(@Headers('authorization') authorization?: string) {
    const merchant = await this.owner.owned(authorization);
    if (!merchant.receivingWallet || !merchant.settlementTermsAcceptedAt)
      throw new ConflictException(
        'Receiving account and settlement terms are required',
      );
    // Production provisioning follows verification. Devnet account creation
    // spends test SOL only; it does not mark business verification complete.
    if (
      this.config.get<string>('SOLANA_CLUSTER') !== 'devnet' &&
      merchant.kybStatus !== 'verified'
    )
      throw new ConflictException('Business verification is required');
    try {
      const result = await this.provisioning.provisionOrLink(merchant.id, {
        currency: 'USDC',
        merchantAddress: merchant.receivingWallet,
      });
      await this.audit.record({
        merchantId: merchant.id,
        actor: merchant.ownerProviderId ?? 'unknown',
        action: 'destination.provision',
        target: merchant.id,
      });
      return result;
    } catch (error) {
      if (error instanceof SettlementAccountNotProvisionedError)
        throw new ConflictException(
          'The receiving account is not confirmed yet. Wait a moment and retry initialization. No Payment has been made.',
        );
      throw error;
    }
  }

  @Post('keys/:id/revoke')
  async revoke(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    const merchant = await this.owner.owned(authorization);
    await this.ownedKey(merchant.id, id);
    const revoked = await this.keys.revokeKey(id);
    await this.audit.record({
      merchantId: merchant.id,
      actor: merchant.ownerProviderId ?? 'unknown',
      action: 'api_key.revoke',
      target: id,
    });
    return { id: revoked.id, revokedAt: revoked.revokedAt.toISOString() };
  }

  @Post('keys/:id/rotate')
  async rotate(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    const merchant = await this.owner.owned(authorization);
    await this.ownedKey(merchant.id, id);
    try {
      const issued = await this.keys.rotateKey(id, merchant.id);
      await this.audit.record({
        merchantId: merchant.id,
        actor: merchant.ownerProviderId ?? 'unknown',
        action: 'api_key.rotate',
        target: issued.id,
        metadata: { rotatedFrom: id },
      });
      return issued;
    } catch (error) {
      if (error instanceof ApiKeyNotFoundError)
        throw new NotFoundException('API key not found');
      throw error;
    }
  }

  @Post('keys')
  async issue(
    @Headers('authorization') authorization: string | undefined,
    @Body(new ZodValidationPipe(KeyRequest)) body: z.infer<typeof KeyRequest>,
  ) {
    const merchant = await this.owner.owned(authorization);
    if (body.mode === 'live') {
      if (merchant.kybStatus !== 'verified')
        throw new ConflictException(
          'Business verification is required before live keys',
        );
      await this.requireDestination(merchant.id);
    }
    if (body.mode === 'devnet') {
      if (!devnetExecutionEnabled(this.config))
        throw new ConflictException('Devnet execution is disabled');
      await this.requireDestination(merchant.id);
    }
    const issued = await this.keys.issueKey(merchant.id, body.mode, {
      name: body.name,
    });
    await this.audit.record({
      merchantId: merchant.id,
      actor: merchant.ownerProviderId ?? 'unknown',
      action: 'api_key.issue',
      target: issued.id,
      metadata: { mode: body.mode },
    });
    return issued;
  }

  private async ownedKey(merchantId: string, id: string): Promise<void> {
    const [key] = await this.db.client
      .select({ id: apiKeys.id, merchantId: apiKeys.merchantId })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.merchantId, merchantId)))
      .limit(1);
    if (!key || key.merchantId !== merchantId)
      throw new NotFoundException('API key not found');
  }

  private async requireDestination(merchantId: string): Promise<void> {
    try {
      await this.provisioning.getSettlementAddressForSettlement(merchantId);
    } catch (error) {
      if (error instanceof SettlementAccountNotProvisionedError)
        throw new ConflictException(
          'Initialize and confirm your receiving account before creating an execution key.',
        );
      throw error;
    }
  }
}
