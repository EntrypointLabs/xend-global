// Binding brand tokens (HANDOFF Level 3). Nothing in the SDK hardcodes a
// hex value inline; everything reads from here.
//
// Green is reserved exclusively for the passkey success checkmark on the
// checkout surface and MUST NOT appear on this button. The button is
// never green.

/** The brand background. Note: #0a0a0a, never pure #000000. */
export const BRAND_BLACK = "#0a0a0a";

/** Label color on the brand background. Kept white for >= 4.5:1 contrast. */
export const LABEL_COLOR = "#ffffff";

/** Corner radius of the Xend mark, as a percentage of its box. */
export const MARK_RADIUS_PERCENT = 22;

/** Inter Display Medium, with system fallbacks. The font is referenced,
 * never bundled (bundling a web font would blow the 15 KB budget). */
export const FONT_STACK =
  "'Inter Display', 'Inter', -apple-system, system-ui, sans-serif";

/** Inter Display Medium. */
export const FONT_WEIGHT = 500;

export const LETTER_SPACING = "-0.01em";

export const LABEL_TEXT = "Pay with Xend";

/** Minimum touch target (px). */
export const MIN_TOUCH_TARGET = 44;
