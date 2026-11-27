/**
 * Events the backend sends to PostHog. They are the authoritative record of
 * an outcome (the chain confirmed it, the provider settled it), where the
 * client's `*_succeeded` only says the app saw it. All are prefixed `server_`
 * so a funnel never mixes the two by accident.
 *
 * The same privacy rules as the apps apply: internal ids only, amounts as
 * ranges, reasons as short codes.
 */
export type ServerEventProps = {
  merchant_id?: string;
  intent_id?: string;
  payment_id?: string;
  amount_bucket?: string;
  currency?: string;
  token?: string;
  to_token?: string;
  provider?: string;
  rail?: string;
  kind?: string;
  reason?: string;
  status?: string;
  step?: string;
  attempt?: number;
};

export type ServerEventName =
  // Merchant payments (mirrored from platform events)
  | 'server_payment_created'
  | 'server_payment_authorized'
  | 'server_payment_succeeded'
  | 'server_payment_failed'
  | 'server_payment_expired'
  | 'server_payment_canceled'
  | 'server_payout_initiated'
  | 'server_payout_completed'
  | 'server_payout_failed'
  | 'server_merchant_connected'
  | 'server_merchant_disconnected'
  // Consumer outcomes
  | 'server_account_provisioned'
  | 'server_transfer_submitted'
  | 'server_transfer_confirmed'
  | 'server_transfer_failed'
  | 'server_swap_submitted'
  | 'server_swap_confirmed'
  | 'server_swap_failed'
  | 'server_earn_submitted'
  | 'server_earn_confirmed'
  | 'server_earn_failed'
  | 'server_fiat_order_created'
  | 'server_fiat_order_completed'
  | 'server_fiat_order_failed'
  | 'server_bank_payout_completed'
  | 'server_bank_payout_failed'
  | 'server_kyc_completed'
  | 'server_account_change_completed'
  // Merchant operations
  | 'server_merchant_registered'
  | 'server_refund_issued'
  | 'server_refund_failed'
  | 'server_webhook_delivery_failed';
