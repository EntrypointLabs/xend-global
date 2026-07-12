import { useEffect, useRef } from "react";
import {
  mountXendButton,
  type CheckoutResult,
  type CheckoutStatus,
  type CheckoutUnresolved,
} from "@xend/checkout-core";

export type { CheckoutResult, CheckoutStatus, CheckoutUnresolved };

export interface XendPayButtonProps {
  /** Exact checkout origin, e.g. "https://pay.xend.global". */
  checkoutOrigin: string;
  /** Your server call that creates the intent and returns its reference. */
  createIntent: () => Promise<{ reference: string }>;
  /** Reference + status only. NOT settlement truth: confirm server-side. */
  onResult: (result: CheckoutResult) => void;
  onUnresolved?: (u: CheckoutUnresolved) => void;
  onReady?: () => void;
}

/**
 * Thin React wrapper over @xend/checkout-core. All popup, postMessage,
 * nonce, and brand logic lives in core; this component only mounts the
 * vanilla button into a container ref and forwards callbacks. The latest
 * callbacks are held in a ref so re-rendering with new callback identities
 * does not tear down and rebuild the button (which would drop an in-flight
 * popup handle). The button remounts only when checkoutOrigin changes.
 */
export function XendPayButton(props: XendPayButtonProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;

  const { checkoutOrigin } = props;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handle = mountXendButton({
      mount: el,
      checkoutOrigin,
      createIntent: () => latest.current.createIntent(),
      onResult: (result) => latest.current.onResult(result),
      onUnresolved: (u) => latest.current.onUnresolved?.(u),
      onReady: () => latest.current.onReady?.(),
    });
    return () => handle.unmount();
  }, [checkoutOrigin]);

  return <div ref={ref} />;
}
