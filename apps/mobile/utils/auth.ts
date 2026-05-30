/**
 * Auth storage keys. Phase 5 pruned the Grid-shaped legacy keys
 * (SESSION_SECRETS, KEYPAIR, CREDENTIALS_BUNDLE, MPC_PRIMARY_ID,
 * SMART_ACCOUNT_ADDRESS, GRID_USER_ID, MIGRATION_DONE, EXTERNAL_ACCOUNTS,
 * ACCOUNT_INFO, WALLET) along with the Grid-backed `registerUser`,
 * `authenticateUser`, `verifyOtpCodeAndCreateAccount`, `verifyOtpCode`
 * exports. KYC-related keys (KYC_STATUS, KYC_LINK, BRIDGE_KYC_LINK_IDS)
 * stay alive because the KYC swarm is deferred to last.
 */
export const AUTH_STORAGE_KEYS = {
  USER: "auth_user",
  EMAIL: "auth_email",
  TOKEN: "auth_token",
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
  // (send)/fiatamount.tsx). Not a Grid-shaped key; harmless to keep.
  EXTERNAL_ACCOUNTS: "auth_external_accounts",
};
