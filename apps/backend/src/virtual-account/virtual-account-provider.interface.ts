/**
 * Anti-lock-in seam for fiat-funded virtual accounts (Iron / BVNK / etc.),
 * which are out of scope for v1. This interface exists only so the
 * eventual implementation slots in cleanly without rewriting the `kyc`
 * module or introducing a new boundary later.
 *
 * No concrete adapter, DI binding, or module wiring exists yet; the
 * `VIRTUAL_ACCOUNT_PROVIDER` DI symbol is intentionally omitted until an
 * adapter consumes it.
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
