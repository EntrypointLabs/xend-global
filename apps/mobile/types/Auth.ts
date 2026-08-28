import { z } from "zod/v4";

export const Email = z.email();

export interface AccountInfo {
  mpc_primary_id: string;
  wallet_id: string; // Id of the wallet that has permissions for smart account
  smart_account_signer_public_key: string; // Public key set in the smart account settings
  smart_account_address: string;
  grid_user_id: string;
}

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
  authenticate: (email: string) => Promise<void>;
  register: (email: string) => Promise<void>;
  verifyCode: (code: string) => Promise<boolean>;
  verifyCodeAndCreateAccount: (code: string) => Promise<boolean>;
  completeLogin: (userData: any, email: string, token: string) => Promise<void>;
  logout: () => Promise<void>;
  wallet: string | null;
  isLoading: boolean;
  isLoggingOut: boolean;
  /**
   * Whether the shell should still be asking for a contact address.
   *
   * Not dismissable. S3 is anchored on this address and is mandatory at
   * Account creation (D10b), so a Consumer without one has no Account and no
   * recovery signer at all: the 0 of 3 state the design exists to prevent.
   */
  needsContactEmail: boolean;
  /**
   * True while a screen in the auth stack is finishing something after the
   * session already exists, so the shell must not redirect out from under it.
   */
  holdAuthStack: boolean;
  releaseAuthStack: () => void;
  /**
   * Finishes a sign-in that Privy has already authenticated with a passkey.
   * Everything after the credential is identical to any other sign-in.
   */
  completePasskeySession: (privyUser: unknown) => Promise<boolean>;
}
