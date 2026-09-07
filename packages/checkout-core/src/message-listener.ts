import {
  isCheckoutReady,
  parseCheckoutEnvelope,
} from "./adapters/checkout-message.adapter";
import type { CheckoutResult, CheckoutUnresolved } from "./types";

export interface ListenConfig {
  checkoutOrigin: string;
  reference: string;
  nonce: string;
  onResult: (result: CheckoutResult) => void;
  onUnresolved?: (u: CheckoutUnresolved) => void;
  /** Optional popup handle, polled so a close-before-result resolves as unresolved. */
  popup?: Window | null;
  /**
   * Fires on the surface's mount handshake. A frame the checkout refused to be
   * embedded in can never send it, so its arrival is the proof that the
   * checkout actually loaded.
   */
  onAlive?: () => void;
}

export interface ListenHandle {
  teardown: () => void;
}

const POPUP_POLL_MS = 400;

/**
 * Listen for the checkout result. Enforces, in order:
 *   1. reject event.origin === 'null'
 *   2. require event.origin === checkoutOrigin by STRICT equality
 *      (never includes/startsWith/regex)
 *   3. parse via the Phase 5 seam, matching BOTH reference and nonce
 * Unknown protocol versions and non-matching messages are ignored
 * silently. The mount handshake reports liveness and never resolves a
 * result. A cancel message resolves as status 'canceled'. If the popup
 * closes before a result arrives (COOP severing / user close), resolve as
 * unresolved rather than a false 'failed'; fulfillment is server-side.
 */
export function listenForResult(config: ListenConfig): ListenHandle {
  const {
    checkoutOrigin,
    reference,
    nonce,
    onResult,
    onUnresolved,
    onAlive,
    popup,
  } = config;
  let settled = false;

  const handleMessage = (event: MessageEvent): void => {
    if (settled) return;
    if (event.origin === "null") return;
    if (event.origin !== checkoutOrigin) return;
    if (isCheckoutReady(event.data, { nonce })) {
      onAlive?.();
      return;
    }
    const result = parseCheckoutEnvelope(event.data, { reference, nonce });
    if (!result) return;
    settled = true;
    teardown();
    onResult(result);
  };

  let pollId: ReturnType<typeof setInterval> | undefined;
  if (popup) {
    pollId = setInterval(() => {
      if (settled) return;
      if (popup.closed) {
        settled = true;
        teardown();
        onUnresolved?.({
          reference,
          status: "unresolved",
          reason: "popup_closed",
        });
      }
    }, POPUP_POLL_MS);
  }

  function teardown(): void {
    window.removeEventListener("message", handleMessage);
    if (pollId !== undefined) clearInterval(pollId);
  }

  window.addEventListener("message", handleMessage);

  return { teardown };
}
