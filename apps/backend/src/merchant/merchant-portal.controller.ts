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
import {
  ApiKeyNotFoundError,
  ExecutionClusterDisabledError,
  KybNotVerifiedError,
  SettlementDestinationMissingError,
} from './merchant.errors';
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
    // The conditional update and its audit entry commit together, so a failed
    // audit write cannot leave a persisted, version-bumped profile with no
    // trail (and the retry, carrying the old expectedVersion, would then 409).
    const updated = await this.db.client.transaction(async (tx) => {
      const [row] = await tx
        .update(merchants)
        .set({
          displayName: body.displayName,
          businessProfile: body.profile,
          profileVersion: body.expectedVersion + 1,
          // Editing the profile withdraws any pending submission: the reviewer
          // must see the changed details, so verification cannot be stamped
          // against the version they already read.
          kybSubmittedAt: null,
          kybSubmittedVersion: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(merchants.id, merchant.id),
            eq(merchants.profileVersion, body.expectedVersion),
            // A verification decision may land after the ownership read. Do not
            // save a legal-name edit under an obsolete pending-verification
            // state.
            eq(merchants.kybStatus, merchant.kybStatus),
          ),
        )
        .returning();
      if (!row)
        throw new ConflictException(
          'This profile changed in another session. Reload the latest profile before saving.',
        );
      await this.audit.record(
        {
          merchantId: merchant.id,
          actor: merchant.ownerProviderId ?? 'unknown',
          action: 'profile.update',
          target: merchant.id,
          metadata: { version: String(row.profileVersion) },
        },
        tx,
      );
      return row;
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
    // A review needs something to review: refuse a submission until the minimum
    // legal, contact and address details are present, so a merchant cannot land
    // in the queue (and see "in review") having supplied nothing.
    const profile = merchant.businessProfile ?? {};
    const requiredFields: Array<[keyof typeof profile, string]> = [
      ['legalName', 'legal business name'],
      ['contactName', 'contact name'],
      ['contactEmail', 'business contact email'],
      ['addressLine1', 'address'],
      ['city', 'city'],
      ['country', 'country'],
    ];
    const missing = requiredFields.filter(
      ([key]) => !(profile[key] ?? '').trim(),
    );
    if (missing.length > 0)
      throw new ConflictException(
        `Add your ${missing.map(([, label]) => label).join(', ')} before submitting for verification.`,
      );
    const now = new Date();
    const updated = await this.db.client.transaction(async (tx) => {
      const [row] = await tx
        .update(merchants)
        .set({
          kybStatus: 'pending',
          kybSubmittedAt: now,
          // Bind the review to the exact profile version being submitted.
          kybSubmittedVersion: merchant.profileVersion,
          kybReviewNote: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(merchants.id, merchant.id),
            // Verification can be stamped by an operator between the ownership
            // read and this update. Only move to pending from the exact status
            // observed, so a submission never reverts a merchant that just
            // became verified (which would disable their live keys).
            eq(merchants.kybStatus, merchant.kybStatus),
          ),
        )
        .returning();
      if (!row)
        throw new ConflictException(
          'Your verification status changed. Reload your account before resubmitting.',
        );
      await this.audit.record(
        {
          merchantId: merchant.id,
          actor: merchant.ownerProviderId ?? 'unknown',
          action: 'kyb.submit',
          target: merchant.id,
        },
        tx,
      );
      return row;
    });
    return this.dashboard({
      ...updated,
      signInEmail: merchant.signInEmail,
    });
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
      .where(
        and(
          eq(paymentIntents.merchantId, merchant.id),
          eq(paymentIntents.executionCluster, cluster),
        ),
      )
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
      cluster,
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
      // A lost-response retry returns the existing destination with
      // provisioned=false; record the audit entry only for the call that
      // actually provisioned, so the trail does not show a repeat change.
      if (result.provisioned)
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
    // Revoke and its audit entry commit together: a failed audit write must not
    // leave a revocation that no trail records.
    const revoked = await this.db.client.transaction(async (tx) => {
      const result = await this.keys.revokeKey(id, tx);
      // A retry of a lost response re-revokes idempotently; only record the
      // audit entry for the call that actually performed the transition, so the
      // append-only trail does not show a second revocation that never happened.
      if (result.claimed)
        await this.audit.record(
          {
            merchantId: merchant.id,
            actor: merchant.ownerProviderId ?? 'unknown',
            action: 'api_key.revoke',
            target: id,
          },
          tx,
        );
      return result;
    });
    return { id: revoked.id, revokedAt: revoked.revokedAt.toISOString() };
  }

  @Post('keys/:id/rotate')
  async rotate(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    const merchant = await this.owner.owned(authorization);
    try {
      // The whole rotation is one transaction: claiming the old key, issuing
      // the successor and recording the audit entry commit together, so an
      // audit or issuance failure rolls the revocation back and the old key
      // keeps working. The claim inside rotateKey also serialises concurrent
      // rotations and enforces ownership.
      return await this.db.client.transaction(async (tx) => {
        const issued = await this.keys.rotateKey(id, merchant.id, tx);
        await this.audit.record(
          {
            merchantId: merchant.id,
            actor: merchant.ownerProviderId ?? 'unknown',
            action: 'api_key.rotate',
            target: issued.id,
            metadata: { rotatedFrom: id },
          },
          tx,
        );
        return issued;
      });
    } catch (error) {
      if (error instanceof ApiKeyNotFoundError)
        throw new NotFoundException('API key not found');
      // A live key can become ineligible to rotate after issuance (KYB
      // regressed, destination incomplete, or the cluster disabled). These are
      // merchant-actionable conflicts, not server errors; the transaction has
      // already rolled the claim back, so the old key still works.
      if (
        error instanceof KybNotVerifiedError ||
        error instanceof SettlementDestinationMissingError ||
        error instanceof ExecutionClusterDisabledError
      )
        throw new ConflictException(error.message);
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
      if (this.config.get<string>('SOLANA_CLUSTER') === 'devnet')
        throw new ConflictException(
          'Live keys are unavailable on devnet. Create a devnet execution key instead.',
        );
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
    return this.db.client.transaction(async (tx) => {
      const issued = await this.keys.issueKey(
        merchant.id,
        body.mode,
        { name: body.name },
        tx,
      );
      await this.audit.record(
        {
          merchantId: merchant.id,
          actor: merchant.ownerProviderId ?? 'unknown',
          action: 'api_key.issue',
          target: issued.id,
          metadata: { mode: body.mode },
        },
        tx,
      );
      return issued;
    });
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
