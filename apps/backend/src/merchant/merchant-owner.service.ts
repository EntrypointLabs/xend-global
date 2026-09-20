import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { merchants } from '../db/schema';
import {
  PrivyUnavailableError,
  PrivyUserShapeError,
} from '../wallet/privy.errors';
import type { WalletProviderUser } from '../wallet/wallet-provider.interface';
import { MerchantIdentityService } from './merchant-identity.service';

export type OwnedMerchant = typeof merchants.$inferSelect & {
  signInEmail: string | null;
};

/**
 * Resolves the Merchant that owns an owner-authenticated portal request.
 * Every portal controller shares this so the identity boundary is defined
 * once: the owner comes from a verified provider token, never a submitted id,
 * and the same provider-outage and shape errors map to the same HTTP codes
 * across the portal surface.
 */
@Injectable()
export class MerchantOwnerService {
  constructor(
    private readonly db: DbService,
    private readonly identityService: MerchantIdentityService,
  ) {}

  async identity(authorization?: string): Promise<WalletProviderUser> {
    if (!authorization?.startsWith('Bearer '))
      throw new UnauthorizedException();
    try {
      return await this.identityService.verifyIdToken(authorization.slice(7));
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

  async owned(authorization?: string): Promise<OwnedMerchant> {
    return this.ownedForIdentity(await this.identity(authorization));
  }

  async ownedForIdentity(identity: WalletProviderUser): Promise<OwnedMerchant> {
    const [merchant] = await this.db.client
      .select()
      .from(merchants)
      .where(eq(merchants.ownerProviderId, identity.providerUserId))
      .limit(1);
    if (!merchant)
      throw new NotFoundException('Create your Merchant account first');
    return { ...merchant, signInEmail: identity.email ?? null };
  }
}
