import type { AmountBucket } from "./bucket";

export type AppName = "mobile" | "merchant" | "checkout" | "shop";

/**
 * Money-moving flows share one funnel shape so every flow reads the same way
 * in PostHog: `<flow>_started` → `<flow>_submitted` → `<flow>_succeeded` or
 * `<flow>_failed`. `_cancelled` is a deliberate user exit, not a failure.
 */
export type MoneyFlow =
  | "send"
  | "swap"
  | "earn_deposit"
  | "earn_withdraw"
  | "naira_deposit"
  | "naira_withdraw"
  | "payment_approval"
  | "spending_limit_change"
  | "recovery_change"
  | "passkey_replace"
  | "device_restore"
  | "account_setup";

export type FlowStage =
  | "started"
  | "submitted"
  | "succeeded"
  | "failed"
  | "cancelled";

export type FlowEventName = `${MoneyFlow}_${FlowStage}`;

export type FlowProps = {
  /** Which path inside the flow, e.g. `wallet`, `bank`, `contact` for send. */
  rail?: string;
  token?: string;
  to_token?: string;
  provider?: string;
  amount_bucket?: AmountBucket;
  needs_approval?: boolean;
  /** Short machine code from `errorReason`, never a raw error message. */
  reason?: string;
  step?: string;
};

type SignInMethod = "email" | "passkey" | "apple" | "google" | "wallet";

type NamedEvents = {
  // Mobile: identity and lifecycle
  app_opened: { cold_start: boolean };
  app_backgrounded: Record<string, never>;
  auth_login_started: { method: SignInMethod };
  auth_login_succeeded: { method: SignInMethod; is_new_user?: boolean };
  auth_login_failed: { method: SignInMethod; reason: string };
  auth_logged_out: Record<string, never>;
  app_unlocked: { method: "biometric" | "passcode" | "none" };
  push_permission_answered: { granted: boolean };
  notification_opened: { kind: string };

  // Mobile: engagement
  feature_opened: { feature: string; source?: string };
  coming_soon_tapped: { feature: string };
  nudge_tapped: { nudge: string };
  nudge_dismissed: { nudge: string };
  receive_details_copied: { kind: "address" | "account_number" | "link" };
  receive_details_shared: { kind: "address" | "account_number" | "link" };
  qr_scanned: { kind: string };
  token_viewed: { token: string };
  watchlist_changed: { token: string; added: boolean };
  history_filtered: { filter: string };
  transaction_opened: { kind: string };
  recovery_method_added: { kind: "email" | "wallet" | "key" };
  merchant_disconnected: Record<string, never>;
  contact_saved: Record<string, never>;
  appearance_changed: { setting: string; value: string };
  support_opened: { channel: string; topic?: string };
  feedback_submitted: { has_text: boolean };
  identity_verification_started: Record<string, never>;
  identity_verification_completed: { outcome: string };

  // Merchant portal
  merchant_signed_in: Record<string, never>;
  merchant_signed_out: Record<string, never>;
  merchant_workspace_created: Record<string, never>;
  merchant_profile_saved: { category?: string };
  merchant_brand_saved: { part?: "logo" | "logo_removed" | "category" };
  merchant_receiving_account_saved: { kind?: string };
  merchant_api_key_created: { mode?: string; rotated?: boolean };
  merchant_api_key_revealed: Record<string, never>;
  merchant_api_key_revoked: Record<string, never>;
  merchant_webhook_saved: { is_new: boolean };
  merchant_webhook_deleted: Record<string, never>;
  merchant_webhook_tested: { ok: boolean };
  merchant_payment_opened: { status?: string };
  merchant_payments_filtered: { filter: string };
  merchant_review_submitted: Record<string, never>;
  merchant_action_failed: { action: string; reason: string };

  // Hosted checkout (the Pay page). The npm SDKs never send events.
  checkout_opened: {
    mode: "iframe" | "popup" | "redirect" | "direct";
    merchant_id?: string;
  };
  checkout_sign_in_started: { method: SignInMethod };
  checkout_signed_in: { method: SignInMethod };
  checkout_quote_shown: { token?: string; amount_bucket?: AmountBucket };
  checkout_quote_expired: Record<string, never>;
  checkout_insufficient_balance: { amount_bucket?: AmountBucket };
  checkout_approval_required: Record<string, never>;
  checkout_confirmed: { amount_bucket?: AmountBucket };
  checkout_paid: { amount_bucket?: AmountBucket };
  checkout_failed: { reason: string; stage?: string };
  checkout_cancelled: { stage?: string };

  // Demo shop
  shop_product_viewed: { product: string };
  shop_added_to_bag: { product: string; quantity: number };
  shop_removed_from_bag: { product: string };
  shop_checkout_started: { items: number; amount_bucket?: AmountBucket };
  shop_order_paid: { amount_bucket?: AmountBucket };
  shop_order_failed: { reason: string };
  shop_order_lookup: { found: boolean };
};

export type AnalyticsEvents = NamedEvents & {
  [K in FlowEventName]: FlowProps;
};

export type EventName = keyof AnalyticsEvents;
