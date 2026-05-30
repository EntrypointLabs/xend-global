import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  ProviderUserId,
  SignatureRequest,
  WalletProvider,
  WalletProviderUser,
} from './wallet-provider.interface';

/**
 * Privy wallet provider adapter — STUB.
 *
 * Real implementation lands in Phase 1 against `@privy-io/server-auth`:
 *   - verifyIdToken: validate Privy ID token against Privy's JWKS
 *   - getUser: fetch the embedded Solana wallet for a Privy user ID
 *
 * Every method throws NotImplementedException so an accidental call in the
 * old code path (which still uses GridService) surfaces loudly instead of
 * silently returning an empty value. The `(Phase 1)` suffix tells the next
 * caller exactly when the real behaviour arrives.
 */
@Injectable()
export class PrivyAdapter implements WalletProvider {
  async verifyIdToken(_idToken: string): Promise<WalletProviderUser> {
    throw new NotImplementedException(
      'PrivyAdapter.verifyIdToken (Phase 1)',
    );
  }

  async getUser(_providerUserId: ProviderUserId): Promise<WalletProviderUser> {
    throw new NotImplementedException('PrivyAdapter.getUser (Phase 1)');
  }

  async signTransaction(_req: SignatureRequest): Promise<string> {
    throw new NotImplementedException(
      'PrivyAdapter.signTransaction (Phase 1)',
    );
  }
}
