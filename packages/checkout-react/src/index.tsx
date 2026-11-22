import { useEffect, useRef } from "react";
import {
  mountPryddButton,
  type ButtonTheme,
  type CheckoutPresentation,
  type CheckoutResult,
  type CheckoutStatus,
  type CheckoutUnresolved,
} from "@prydd/checkout-core";

export type {
  ButtonTheme,
  CheckoutPresentation,
  CheckoutResult,
  CheckoutStatus,
  CheckoutUnresolved,
};

export interface PryddPayButtonProps {
  /** Where the hosted checkout lives. Defaults to "https://prydd.co/pay". */
  checkoutUrl?: string;
  /** Your server call that creates the intent and returns its reference. */
  createIntent: () => Promise<{ reference: string }>;
  /** Reference + status only. NOT settlement truth: confirm server-side. */
  onResult: (result: CheckoutResult) => void;
  onUnresolved?: (u: CheckoutUnresolved) => void;
  onReady?: () => void;
  /** "modal" (default: glass sheet plus a Prydd window), "iframe", "popup" or "redirect". Webviews and blocked popups redirect on their own. */
  presentation?: CheckoutPresentation;
  /** Origin of the Prydd API. Defaults to "https://api.prydd.co". */
  apiBase?: string;
  /** "auto" (default) follows the viewer's colour scheme; "light" / "dark" pin the material. */
  theme?: ButtonTheme;
}

/**
 * Thin React wrapper over @prydd/checkout-core. All sheet, frame, popup,
 * postMessage, nonce, and brand logic lives in core; this component only mounts
 * the vanilla button into a container ref and forwards callbacks. The latest
 * callbacks are held in a ref so re-rendering with new callback identities
 * does not tear down and rebuild the button (which would drop an in-flight
 * ceremony handle). The button remounts only when a mount-time option
 * (checkoutUrl, presentation, theme, apiBase) changes.
 */
export function PryddPayButton(props: PryddPayButtonProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;

  const { checkoutUrl, presentation, theme, apiBase } = props;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handle = mountPryddButton({
      mount: el,
      checkoutUrl,
      presentation,
      theme,
      apiBase,
      createIntent: () => latest.current.createIntent(),
      onResult: (result) => latest.current.onResult(result),
      onUnresolved: (u) => latest.current.onUnresolved?.(u),
      onReady: () => latest.current.onReady?.(),
    });
    return () => handle.unmount();
  }, [checkoutUrl, presentation, theme, apiBase]);

  return <div ref={ref} />;
}
