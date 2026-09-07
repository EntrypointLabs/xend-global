/**
 * Whether a Privy user has a passkey among its linked accounts — the single
 * definition of "this account has a passkey", used by the passkey hook, the
 * login mutation, and the app lock.
 */
export function hasLinkedPasskey(
  user?: { linked_accounts?: readonly { type: string }[] } | null
): boolean {
  return (
    user?.linked_accounts?.some((account) => account.type === "passkey") ??
    false
  );
}

export const AUTH_STORAGE_KEYS = {
  USER: "auth_user",
  EMAIL: "auth_email",
  TOKEN: "auth_token",
  // What the stored token can do, and when an entry token stops working.
  // An entry session carries no expiry of its own the way a JWT does.
  SESSION_TIER: "auth_session_tier",
  SESSION_EXPIRES_AT: "auth_session_expires_at",
  IS_AUTHENTICATED: "auth_is_authenticated",
  KYC_STATUS: "auth_kyc_status",
  KYC_LINK: "auth_kyc_link",
  BRIDGE_KYC_LINK_IDS: "auth_bridge_kyc_link_id",
  PERSISTENT_EMAIL: "auth_persistent_email",
  CACHED_BALANCE: "auth_cached_balance",
  HAS_PASSKEY: "auth_has_passkey",
  WALLET_NAME: "wallet_name",
  ADDRESS_BOOK: "address_book",
  // Local-only store for fiat off-ramp external account IDs (used by
  // (send)/fiatamount.tsx).
  EXTERNAL_ACCOUNTS: "auth_external_accounts",
};
