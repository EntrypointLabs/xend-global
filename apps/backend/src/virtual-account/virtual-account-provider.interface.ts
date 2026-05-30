/**
 * VirtualAccountProvider — anti-lock-in seam for fiat-funded virtual accounts.
 *
 * The fiat-funded virtual account on-ramp (Iron / BVNK / etc.) is OUT OF SCOPE
 * for v1 of the Grid migration. See PROJECT.md "Out of Scope" and spec §5.8.
 * This interface ships in Phase 0 only so the eventual implementation slots in
 * cleanly without rewriting the `kyc` module or introducing a new boundary
 * later.
 *
 * No concrete adapter, no DI binding, and no module wiring exist in v1. The
 * spec deliberately omits `VIRTUAL_ACCOUNT_PROVIDER` as a DI symbol here
 * because nothing consumes it yet; the symbol will be introduced alongside
 * the adapter in the follow-up spec.
 *
 * Spec: docs/specs/migration-already-built-features.md §5.8, §6.
 */

import type { WalletAddress } from '../wallet/wallet-provider.interface';

export interface VirtualAccount {
  id: string;
  /** ISO-4217 currency code (e.g. 'NGN', 'USD'). */
  currency: string;
  accountNumber: string;
  bankName: string;
}

export interface VirtualAccountProvider {
  requestAccount(input: {
    userId: string;
    walletAddress: WalletAddress;
    currency: string;
  }): Promise<VirtualAccount>;

  getAccounts(walletAddress: WalletAddress): Promise<VirtualAccount[]>;
}
