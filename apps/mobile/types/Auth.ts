import { z } from "zod/v4";

import type { EntryProof } from "@/utils/apiClient";

export const Email = z.email();

export interface AccountInfo {
  mpc_primary_id: string;
  wallet_id: string; // Id of the wallet that has permissions for smart account
  smart_account_signer_public_key: string; // Public key set in the smart account settings
  smart_account_address: string;
  grid_user_id: string;
}

/**
 * How much the current session may do.
 *
 * `full` is a passkey-backed session. `entry` is what an email code opens on
 * an existing account: it can look and can start a recovery, and the server
 * refuses everything else. The app reads this to explain rather than to
 * enforce; enforcement is the server's.
 */
export type SessionTier = "full" | "entry";

export interface AuthContextType {
  isAuthenticated: boolean | null;
  user: any | null;
  email: string | null;
  accountInfo: AccountInfo | null;
  /**
   * Records the Consumer's contact address, in state and in storage.
   *
   * Not the raw state setter: the address is what the shell reads to decide
   * whether sign-up is finished, so it has to survive a relaunch.
   */
  setEmail: (email: string | null) => void;
  setAccountInfo: React.Dispatch<React.SetStateAction<AccountInfo | null>>;
  authError: string | null;
  logout: () => Promise<void>;
  wallet: string | null;
  isLoading: boolean;
  isLoggingOut: boolean;
  /** Null while signed out or still loading. */
  sessionTier: SessionTier | null;
  /**
   * Whether the shell should still be asking for a contact address.
   *
   * Not dismissable. S3 is anchored on this address and is mandatory at
   * Account creation (D10b), so a Consumer without one has no Account and no
   * recovery signer at all: the 0 of 3 state the design exists to prevent.
   */
  needsContactEmail: boolean;
  /**
   * Finishes a sign-in that Privy has already authenticated with a passkey.
   * Everything after the credential is identical to any other sign-in.
   *
   * With a sign-up token, the exchange binds the new passkey to the address
   * the token was issued for instead of starting an empty account. Throws
   * `PasskeyHasNoAccountError` when the passkey belongs to no account at all.
   */
  completePasskeySession: (
    privyUser: unknown,
    signupToken?: string
  ) => Promise<boolean>;
  /**
   * Opens the limited session an email code earned on an existing account.
   * No Privy session stands behind it; the passkey is what upgrades it.
   */
  enterWithEmail: (proof: EntryProof) => Promise<void>;
}
