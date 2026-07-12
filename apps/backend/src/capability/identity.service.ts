import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { passkeyCredentials, smartAccounts, users } from '../db/schema';
import { WALLET_PROVIDER } from '../wallet/wallet-provider.interface';
import type { WalletProvider } from '../wallet/wallet-provider.interface';
import { UnknownConsumerError } from './capability.errors';

export interface ConsumerProfile {
  consumerId: string;
  accountAddress: string;
  email: string | null;
}

/**
 * Resolves a verified identity to a Consumer (id + Account address). Passkey
 * assertion verification happens upstream at the hosted checkout; this service
 * only maps already-verified identities to Consumers, so the wallet-provider
 * interface does not grow a passkey-assertion method here.
 *
 * The credential-id path is first-party: it reads the local
 * passkey_credentials mirror and makes zero vendor calls, so resolution
 * survives a vendor outage. The provider-token path reuses the existing
 * WALLET_PROVIDER seam unchanged.
 */
@Injectable()
export class IdentityService {
  constructor(
    private readonly db: DbService,
    @Inject(WALLET_PROVIDER) private readonly walletProvider: WalletProvider,
  ) {}

  async resolveByCredentialId(credentialId: string): Promise<ConsumerProfile> {
    const [cred] = await this.db.client
      .select()
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.credentialId, credentialId))
      .limit(1);
    if (!cred) {
      throw new UnknownConsumerError(
        `no Consumer for credential ${credentialId}`,
      );
    }
    return this.profileForUser(cred.userId);
  }

  async resolveByProviderToken(idToken: string): Promise<ConsumerProfile> {
    const providerUser = await this.walletProvider.verifyIdToken(idToken);
    const [account] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.providerUserId, providerUser.providerUserId))
      .limit(1);
    if (!account) {
      throw new UnknownConsumerError(
        `no Account for provider user ${providerUser.providerUserId}`,
      );
    }
    return this.profileForUser(account.userId);
  }

  private async profileForUser(userId: string): Promise<ConsumerProfile> {
    const [user] = await this.db.client
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) {
      throw new UnknownConsumerError(`no Consumer ${userId}`);
    }
    const [account] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.userId, userId))
      .limit(1);
    if (!account) {
      throw new UnknownConsumerError(`no Account for consumer ${userId}`);
    }
    return {
      consumerId: user.id,
      accountAddress: account.walletAddress,
      email: user.email,
    };
  }
}
