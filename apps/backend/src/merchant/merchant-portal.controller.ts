import {
  BadGatewayException,
  UnprocessableEntityException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PrivyUnavailableError,
  PrivyUserShapeError,
} from '../wallet/privy.errors';
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
import { MerchantIdentityService } from './merchant-identity.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { KeyIssuanceService } from './key-issuance.service';
import { SettlementProvisioningService } from '../settlement/settlement-provisioning.service';
import { SettlementAccountNotProvisionedError } from '../settlement/settlement.errors';
import { devnetExecutionEnabled } from './devnet-execution';
import { MerchantProfileUpdate } from './profile.dtos';
import type { WalletProviderUser } from '../wallet/wallet-provider.interface';

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
const KeyRequest = z.object({ mode: z.enum(['test', 'live', 'devnet']) });
type OwnedMerchant = typeof merchants.$inferSelect & {
  signInEmail: string | null;
};

/** Owner identity comes from a verified provider token, never a submitted id. */
@Controller('merchant-portal')
export class MerchantPortalController {
  constructor(
    private readonly db: DbService,
    private readonly wallets: MerchantIdentityService,
    private readonly keys: KeyIssuanceService,
    private readonly provisioning: SettlementProvisioningService,
    private readonly config: ConfigService,
  ) {}

  private async identity(authorization?: string) {
    if (!authorization?.startsWith('Bearer '))
      throw new UnauthorizedException();
    try {
      return await this.wallets.verifyIdToken(authorization.slice(7));
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      if (error instanceof PrivyUnavailableError)
        throw new BadGatewayException(
          'Merchant sign-in is temporarily unavailable. Please retry.',
        );
      if (error instanceof PrivyUserShapeError)
        throw new UnprocessableEntityException(error.message);
      throw new UnauthorizedException('Sign in with your Merchant account');
    }
  }

  private async owned(authorization?: string) {
    const identity = await this.identity(authorization);
    return this.ownedForIdentity(identity);
  }

  private async ownedForIdentity(
    identity: WalletProviderUser,
  ): Promise<OwnedMerchant> {
    const [merchant] = await this.db.client
      .select()
      .from(merchants)
      .where(eq(merchants.ownerProviderId, identity.providerUserId))
      .limit(1);
    if (!merchant)
      throw new NotFoundException('Create your Merchant account first');
    return { ...merchant, signInEmail: identity.email ?? null };
  }

  @Post('profile')
  async updateProfile(
    @Headers('authorization') authorization: string | undefined,
    @Body(new ZodValidationPipe(MerchantProfileUpdate))
    body: z.infer<typeof MerchantProfileUpdate>,
  ) {
    const merchant = await this.owned(authorization);
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
    const identity = await this.identity(authorization);
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
    return this.dashboard(await this.ownedForIdentity(identity));
  }

  @Get('me')
  async me(@Headers('authorization') authorization?: string) {
    const merchant = await this.owned(authorization);
    return this.dashboard(merchant);
  }

  private async dashboard(merchant: OwnedMerchant) {
    const cluster = this.config.getOrThrow<string>('SOLANA_CLUSTER');
    const [destination] = await this.db.client
      .select()
      .from(settlementAccounts)
      .where(
        and(
          eq(settlementAccounts.merchantId, merchant.id),
          eq(settlementAccounts.executionCluster, cluster),
        ),
      )
      .limit(1);
    const keys = await this.db.client
      .select({
        id: apiKeys.id,
        fingerprint: apiKeys.fingerprint,
        mode: apiKeys.mode,
        executionCluster: apiKeys.executionCluster,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.merchantId, merchant.id));
    const payments = await this.db.client
      .select({
        id: paymentIntents.id,
        status: paymentIntents.status,
        amountRaw: paymentIntents.usdcSettlementRaw,
        mode: paymentIntents.mode,
        createdAt: paymentIntents.createdAt,
      })
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.merchantId, merchant.id),
          eq(paymentIntents.executionCluster, cluster),
        ),
      )
      .orderBy(desc(paymentIntents.createdAt))
      .limit(20);
    return {
      merchant,
      destination: destination ?? null,
      keys,
      payments,
      cluster,
      devnetExecutionEnabled: devnetExecutionEnabled(this.config),
    };
  }

  @Post('destination')
  async provision(@Headers('authorization') authorization?: string) {
    const merchant = await this.owned(authorization);
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
      return await this.provisioning.provisionOrLink(merchant.id, {
        currency: 'USDC',
        merchantAddress: merchant.receivingWallet,
      });
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
    const merchant = await this.owned(authorization);
    const [key] = await this.db.client
      .select({ id: apiKeys.id, merchantId: apiKeys.merchantId })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.merchantId, merchant.id)))
      .limit(1);
    if (!key || key.merchantId !== merchant.id)
      throw new NotFoundException('API key not found');
    const revoked = await this.keys.revokeKey(key.id);
    return { id: revoked.id, revokedAt: revoked.revokedAt.toISOString() };
  }

  @Post('keys')
  async issue(
    @Headers('authorization') authorization: string | undefined,
    @Body(new ZodValidationPipe(KeyRequest)) body: z.infer<typeof KeyRequest>,
  ) {
    const merchant = await this.owned(authorization);
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
    return this.keys.issueKey(merchant.id, body.mode);
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
