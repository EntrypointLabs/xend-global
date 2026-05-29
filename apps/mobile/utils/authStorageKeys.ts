// Standalone module for AUTH_STORAGE_KEYS so it can be imported by
// `apps/mobile/utils/storage/authStorage.ts` without participating in the
// `auth.ts → apiClient.ts → authStorage.ts → auth.ts` require cycle Metro warns
// about. Existing call sites import from `@/utils/auth` (which re-exports this);
// that keeps the old import paths working.
export const AUTH_STORAGE_KEYS = {
  USER: "auth_user",
  SESSION_SECRETS: "auth_session_secrets",
  EMAIL: "auth_email",
  ACCOUNT_INFO: "auth_account_info",
  KEYPAIR: "auth_keypair",
  CREDENTIALS_BUNDLE: "auth_credentials_bundle",
  WALLET: "auth_wallet",
  TOKEN: "auth_token",
  IS_AUTHENTICATED: "auth_is_authenticated",
  MPC_PRIMARY_ID: "auth_mpc_primary_id",
  KYC_STATUS: "auth_kyc_status",
  SMART_ACCOUNT_ADDRESS: "auth_smart_account_address",
  GRID_USER_ID: "auth_grid_user_id",
  BRIDGE_KYC_LINK_IDS: "auth_bridge_kyc_link_id",
  PERSISTENT_EMAIL: "auth_persistent_email",
  EXTERNAL_ACCOUNTS: "auth_external_accounts",
  KYC_LINK: "auth_kyc_link",
  CACHED_BALANCE: "auth_cached_balance",
  HAS_PASSKEY: "auth_has_passkey",
  WALLET_NAME: "wallet_name",
  ADDRESS_BOOK: "address_book",
  // Phase 7: persistent cursor for the receive-toast pipeline. Survives cold
  // launch so the user isn't flooded with replayed toasts after restarting the
  // app. clearAuthData() iterates Object.values(AUTH_STORAGE_KEYS), so this
  // key is cleared on logout automatically.
  LAST_SEEN_INBOUND_SIG: "auth_last_seen_inbound_sig",
};
