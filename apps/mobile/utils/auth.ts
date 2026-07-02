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
  // (send)/fiatamount.tsx).
  EXTERNAL_ACCOUNTS: "auth_external_accounts",
};
