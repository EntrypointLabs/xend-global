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
import { findVaultAddress } from './vault-address';

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

  /**
   * Whether the development stand-ins are in play.
   *
   * Tied to the settlement short-circuit rather than to NODE_ENV alone: they
   * exist so local Checkout resolves with no Account and no funded authority,
   * and the moment the real path is switched on they hide the failures that
   * path is there to surface.
   */
  private devScaffoldEnabled(): boolean {
    return (
      this.config.get<string>('NODE_ENV') === 'development' &&
      this.config.get<boolean>('CHECKOUT_DEV_FORCE_SETTLE') !== false
    );
  }

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
      // TEST ONLY — never production, and off once development is walking the
      // real Payment path. A passkey with no smart_accounts row is a person
      // whose Account was never created here, and minting a throwaway identity
      // for them is how the orphan rows in this table got made: no email, no
      // Account, and a Payment that fails as though they were short of money.
      // Refusing is the honest answer and matches production.
      if (this.devScaffoldEnabled()) {
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
    // Dev-only provisioning path. A passkey-only identity carries no email,
    // so fall back to a deterministic placeholder rather than matching null.
    const email =
      providerUser.email ?? `${providerUser.providerUserId}@devtest.local`;
    const [existingUser] = await this.db.client
      .select()
      .from(users)
      .where(eq(users.email, email))
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
    return {
      consumerId: user.id,
      accountAddress: await this.accountAddress(userId),
      email: user.email,
    };
  }

  /**
   * The vault. A Consumer part-way through creating their Account has a Privy
   * wallet and no vault, and cannot pay from it, so that is refused rather than
   * answered with an address holding nothing.
   */
  private async accountAddress(userId: string): Promise<string> {
    const vault = await findVaultAddress(this.db, userId);
    if (vault) return vault;

    // TEST ONLY — never production, and off once development is walking the
    // real Payment path, where the vault is read for real. Standing the Privy
    // wallet in past that point reports a Consumer with no Account as one with
    // no money, which is the wrong problem and sends them to top up an Account
    // that does not exist.
    if (this.devScaffoldEnabled()) {
      const [account] = await this.db.client
        .select()
        .from(smartAccounts)
        .where(eq(smartAccounts.userId, userId))
        .limit(1);
      if (account) return account.walletAddress;
    }

    throw new UnknownConsumerError(`no Account for consumer ${userId}`);
  }
}
