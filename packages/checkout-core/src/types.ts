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

/** The checkout channel could not deliver a terminal result. */
export interface CheckoutUnresolved {
  reference: string;
  status: "unresolved";
  reason:
    | "popup_closed"
    | "popup_blocked"
    | "redirected"
    | "channel_lost"
    | "confirmation_timeout";
}

/**
 * "modal" (default) draws the glass sheet in the merchant page and runs the
 * passkey ceremony in a Prydd window. "iframe" runs the ceremony inside the
 * sheet in a cross-origin frame; Prydd's wallet provider will not load under a
 * merchant's page, so it only suits pages Prydd controls. "popup" opens the
 * window straight from the button with no sheet. "redirect" navigates the
 * whole page to the hosted checkout and returns the shopper to the intent's
 * return URL. Webviews, Opera Mini and blocked popups fall back to redirect.
 */
export type CheckoutPresentation = "iframe" | "modal" | "popup" | "redirect";

/**
 * The button's and the sheet's material. "auto" (default) follows the viewer's
 * colour-scheme preference; "light" is the dark button for a light page,
 * "dark" the light button for a dark page.
 */
export type ButtonTheme = "auto" | "light" | "dark";

export interface PryddButtonConfig {
  /**
   * Where the hosted checkout lives. Defaults to "https://prydd.co/pay". Its
   * origin is the only one whose messages the page accepts.
   */
  checkoutUrl?: string;
  /** Merchant-supplied server call that creates the intent and returns its reference. Money never travels client-side. */
  createIntent: () => Promise<{ reference: string }>;
  mount: HTMLElement;
  onResult: (result: CheckoutResult) => void;
  onUnresolved?: (u: CheckoutUnresolved) => void;
  onReady?: () => void;
  presentation?: CheckoutPresentation;
  theme?: ButtonTheme;
  /**
   * Origin of the Prydd API. Defaults to "https://api.prydd.co". The sheet
   * reads the merchant name and amount from it.
   */
  apiBase?: string;
}
