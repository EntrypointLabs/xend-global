import { PublicKey } from "@solana/web3.js";

/**
 * The three signers on an Account, one per identity anchor. See ADR 0025.
 *
 * The role is what the signer is anchored to, not who holds the key, because the
 * anchor is what an attacker has to compromise. Two keys behind one anchor are one
 * factor wearing two hats.
 */
export type SignerRole =
  /** Privy, unlocked by the passkey alone. Present on every spend. */
  | "primary"
  /** Turnkey, unlocked by a biometric-gated hardware key on the phone. */
  | "approval"
  /** Server-held and encrypted, unlocked by proving control of the email. */
  | "recovery";

export interface AccountSigner {
  role: SignerRole;
  address: PublicKey;
}

/**
 * A signer set is only valid if no single compromise yields `threshold` signers, so
 * all three roles must be present and distinct. Enforced by {@link assertSignerSet}.
 */
export type SignerSet = readonly [AccountSigner, AccountSigner, AccountSigner];

export const ACCOUNT_THRESHOLD = 2;

/**
 * How long an approved change to the signer set waits before it can execute.
 *
 * Applies to the Settings only, and never delays a Spend: spends run under
 * policies whose own time lock is 0, because synchronous execution rejects a
 * non-zero time lock on the consensus account it is given.
 *
 * 24 hours, against an industry norm of 3 to 4 days (Braavos 4, Ambire 3,
 * Candide 3). Those are self-custody wallets where every action is deliberate.
 * Here the window only helps a Consumer who still holds their approval signer,
 * since rejecting a change requires it, and such a Consumer sees the
 * notification within minutes. Someone who has genuinely lost their phone cannot
 * reject at all and is simply waiting, so a longer window buys them nothing and
 * costs them a dead phone for days.
 */
export const SETTINGS_TIME_LOCK_SECONDS = 60 * 60 * 24;

export interface AccountAddresses {
  /** Holds the signer set, threshold and time lock. Not where funds live. */
  settings: PublicKey;
  /** The address a Consumer receives into. This is the Account. */
  vault: PublicKey;
}
