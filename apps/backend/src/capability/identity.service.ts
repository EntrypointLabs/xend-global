import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { passkeyCredentials, smartAccounts, users } from '../db/schema';
import { WALLET_PROVIDER } from '../wallet/wallet-provider.interface';
import type {
  WalletProvider,
  WalletProviderUser,
} from '../wallet/wallet-provider.interface';
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
    private readonly config: ConfigService,
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
      // TEST ONLY — never production. A brand-new passkey-only identity has no
      // smart_accounts row yet; in development auto-provision one (mirroring
      // the /auth/exchange insert shape) so local checkout can proceed.
      // Production still rejects with UnknownConsumerError.
      if (this.config.get<string>('NODE_ENV') === 'development') {
        const userId = await this.devProvisionConsumer(providerUser);
        return this.profileForUser(userId);
      }
      throw new UnknownConsumerError(
        `no Account for provider user ${providerUser.providerUserId}`,
      );
    }
    return this.profileForUser(account.userId);
  }

  /**
   * TEST ONLY — never production. Auto-provisions a minimal Consumer for a
   * verified provider identity that has no smart_accounts row yet, reusing the
   * exact insert shape /auth/exchange (AuthService.exchange) uses: upsert the
   * users row by email, then upsert the smart_accounts row keyed on user_id.
   * The consumer inherits the default capacity tier automatically
   * (CapacityService.getTierForConsumer returns CAPACITY_DEFAULT_TIER for all
   * consumers). Guarded by the NODE_ENV==='development' check at the call site.
   */
  private async devProvisionConsumer(
    providerUser: WalletProviderUser,
  ): Promise<string> {
    const [existingUser] = await this.db.client
      .select()
      .from(users)
      .where(eq(users.email, providerUser.email))
      .limit(1);

    let userId: string;
    if (existingUser) {
      userId = existingUser.id;
    } else {
      const [inserted] = await this.db.client
        .insert(users)
        .values({ email: providerUser.email })
        .returning();
      userId = inserted.id;
    }

    await this.db.client
      .insert(smartAccounts)
      .values({
        userId,
        walletAddress: providerUser.walletAddress,
        provider: 'privy',
        providerUserId: providerUser.providerUserId,
      })
      .onConflictDoUpdate({
        target: smartAccounts.userId,
        set: {
          walletAddress: providerUser.walletAddress,
          provider: 'privy',
          providerUserId: providerUser.providerUserId,
          updatedAt: new Date(),
        },
      });

    return userId;
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
