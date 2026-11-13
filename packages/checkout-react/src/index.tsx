import { useEffect, useRef } from "react";
import {
  mountXendButton,
  type ButtonTheme,
  type CheckoutPresentation,
  type CheckoutResult,
  type CheckoutStatus,
  type CheckoutUnresolved,
} from "@xend/checkout-core";

export type {
  ButtonTheme,
  CheckoutPresentation,
  CheckoutResult,
  CheckoutStatus,
  CheckoutUnresolved,
};

export interface XendPayButtonProps {
  /** Exact checkout origin, e.g. "https://pay.xend.global". */
  checkoutOrigin: string;
  /** Your server call that creates the intent and returns its reference. */
  createIntent: () => Promise<{ reference: string }>;
  /** Reference + status only. NOT settlement truth: confirm server-side. */
  onResult: (result: CheckoutResult) => void;
  onUnresolved?: (u: CheckoutUnresolved) => void;
  onReady?: () => void;
  /** "iframe" (default: glass sheet, inline ceremony), "modal" (sheet plus a window), "popup" or "redirect". Webviews and blocked popups redirect on their own. */
  presentation?: CheckoutPresentation;
  /** Origin of the Xend API. The sheet reads the intent summary from it; without one, the sheet presentations degrade to "popup". */
  apiBase?: string;
  /** "auto" (default) follows the viewer's colour scheme; "light" / "dark" pin the material. */
  theme?: ButtonTheme;
}

/**
 * Thin React wrapper over @xend/checkout-core. All sheet, frame, popup,
 * postMessage, nonce, and brand logic lives in core; this component only mounts
 * the vanilla button into a container ref and forwards callbacks. The latest
 * callbacks are held in a ref so re-rendering with new callback identities
 * does not tear down and rebuild the button (which would drop an in-flight
 * ceremony handle). The button remounts only when a mount-time option
 * (checkoutOrigin, presentation, theme, apiBase) changes.
 */
export function XendPayButton(props: XendPayButtonProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;

  const { checkoutOrigin, presentation, theme, apiBase } = props;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handle = mountXendButton({
      mount: el,
      checkoutOrigin,
      presentation,
      theme,
      apiBase,
      createIntent: () => latest.current.createIntent(),
      onResult: (result) => latest.current.onResult(result),
      onUnresolved: (u) => latest.current.onUnresolved?.(u),
      onReady: () => latest.current.onReady?.(),
    });
    return () => handle.unmount();
  }, [checkoutOrigin, presentation, theme, apiBase]);

  return <div ref={ref} />;
}
