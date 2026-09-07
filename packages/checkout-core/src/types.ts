/** Canonical statuses (Phase 5 contract): single-l 'canceled'. */
export type CheckoutStatus = "succeeded" | "failed" | "canceled" | "expired";

/**
 * The ONLY result shape handed to merchant JavaScript. Deliberately
 * fulfillment-hostile: reference + status only, no amount and no
 * "verified" flag, so a tampered browser message cannot be mistaken for
 * settlement truth. Fulfillment happens off the webhook or
 * GET /v1/payment_intents/:id, never off this object.
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

/**
 * "modal" (default) draws the glass sheet in the merchant page and opens the
 * hosted checkout in a window underneath it once the shopper taps Pay, so the
 * ceremony still runs on Xend's own origin. "popup" opens that window straight
 * from the button with no sheet. "redirect" navigates the whole page to the
 * hosted checkout and returns the shopper to the intent's return URL.
 * Webviews, Opera Mini and blocked popups fall back to redirect on their own.
 */
export type CheckoutPresentation = "modal" | "popup" | "redirect";

/**
 * The button's and the sheet's material. "auto" (default) follows the viewer's
 * colour-scheme preference; "light" is the dark button for a light page,
 * "dark" the light button for a dark page.
 */
export type ButtonTheme = "auto" | "light" | "dark";

export interface XendButtonConfig {
  /** Exact checkout origin, e.g. "https://pay.xend.global". Compared by strict equality. */
  checkoutOrigin: string;
  /** Merchant-supplied server call that creates the intent and returns its reference. Money never travels client-side. */
  createIntent: () => Promise<{ reference: string }>;
  mount: HTMLElement;
  onResult: (result: CheckoutResult) => void;
  onUnresolved?: (u: CheckoutUnresolved) => void;
  onReady?: () => void;
  presentation?: CheckoutPresentation;
  theme?: ButtonTheme;
  /**
   * Origin of the Xend API, e.g. "https://api.xend.global". The sheet reads the
   * merchant name and amount from it; without one, "modal" degrades to "popup".
   */
  apiBase?: string;
}
