/** Canonical statuses (Phase 5 contract): single-l 'canceled'. */
export type CheckoutStatus = "succeeded" | "failed" | "canceled" | "expired";

/**
 * The ONLY result shape handed to merchant JavaScript. Deliberately
 * fulfillment-hostile: reference + status only, no amount and no
 * "verified" flag, so a tampered browser message cannot be mistaken for
 * settlement truth. Fulfillment happens off the webhook or
 * GET /payments/:id, never off this object.
 */
export interface CheckoutResult {
  reference: string;
  status: CheckoutStatus;
}

/** The popup could not deliver a result (closed, COOP-severed, blocked). */
export interface CheckoutUnresolved {
  reference: string;
  status: "unresolved";
  reason: "popup_closed" | "popup_blocked" | "redirected" | "channel_lost";
}

export interface XendButtonConfig {
  /** Exact checkout origin, e.g. "https://pay.xend.global". Compared by strict equality. */
  checkoutOrigin: string;
  /** Merchant-supplied server call that creates the intent and returns its reference. Money never travels client-side. */
  createIntent: () => Promise<{ reference: string }>;
  mount: HTMLElement;
  onResult: (result: CheckoutResult) => void;
  onUnresolved?: (u: CheckoutUnresolved) => void;
  onReady?: () => void;
  /**
   * How the checkout is presented. "modal" (default) draws the frosted glass
   * sheet in the merchant page. "popup" opens a separate window; "redirect"
   * navigates the full page. Webviews / blocked popups fall back automatically.
   */
  presentation?: "modal" | "popup" | "redirect";
  /** Backend base URL for the checkout summary + authorize (required for "modal"). */
  apiBase?: string;
  /** Sheet material. "auto" (default) follows the viewer's light/dark preference. */
  theme?: "auto" | "light" | "dark";
  /** DEV/demo only: resolve confirm to success without a real passkey ceremony. */
  devSimulateAuthorize?: boolean;
}
