import { renderButton, type ButtonHandle } from "./button";
import { detectEnvironment } from "./environment";
import { listenForResult, type ListenHandle } from "./message-listener";
import {
  buildCheckoutUrl,
  generateNonce,
  navigatePopup,
  openCheckoutWindow,
  redirectTo,
} from "./popup";
import type {
  CheckoutResult,
  CheckoutStatus,
  CheckoutUnresolved,
  XendButtonConfig,
} from "./types";

export type {
  CheckoutResult,
  CheckoutStatus,
  CheckoutUnresolved,
  XendButtonConfig,
};

export interface XendButtonHandle {
  unmount: () => void;
}

function assertHttpsOrigin(origin: string): void {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`checkoutOrigin must be a valid URL, got: ${origin}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`checkoutOrigin must be https, got: ${origin}`);
  }
  if (url.origin !== origin.replace(/\/$/, "")) {
    throw new Error(
      `checkoutOrigin must be a bare origin (no path), got: ${origin}`,
    );
  }
}

/**
 * Mount the Pay with Xend button. The click handler generates a nonce and
 * opens the popup SYNCHRONOUSLY (intent-less URL) before any awaited work,
 * so iOS Safari does not block it; the intent is created afterward and the
 * popup is navigated to the full URL. In a webview / Opera Mini / when the
 * popup is blocked, the flow falls back to a full-page redirect.
 */
export function mountXendButton(config: XendButtonConfig): XendButtonHandle {
  const {
    checkoutOrigin,
    createIntent,
    mount,
    onResult,
    onUnresolved,
    onReady,
  } = config;
  assertHttpsOrigin(checkoutOrigin);

  const doc = mount.ownerDocument;
  const preconnect = doc.createElement("link");
  preconnect.rel = "preconnect";
  preconnect.href = checkoutOrigin;
  doc.head.appendChild(preconnect);

  let listener: ListenHandle | undefined;

  const handleClick = (): void => {
    // Synchronous, in exact order: nonce, then window.open, BEFORE any await.
    const nonce = generateNonce();
    const env = detectEnvironment();
    const win = env.canPopup ? openCheckoutWindow(checkoutOrigin, nonce) : null;
    const usePopup = env.canPopup && win !== null;

    button.setState("processing");

    createIntent()
      .then(({ reference }) => {
        if (usePopup && win) {
          navigatePopup(
            win,
            buildCheckoutUrl(checkoutOrigin, {
              reference,
              nonce,
              mode: "popup",
            }),
          );
          listener = listenForResult({
            checkoutOrigin,
            reference,
            nonce,
            popup: win,
            onResult: (result) => {
              button.setState("ready");
              onResult(result);
            },
            onUnresolved: (u) => {
              button.setState("ready");
              onUnresolved?.(u);
            },
          });
          return;
        }

        // Redirect fallback: blocked popup or an environment where a popup
        // is unsafe (webview / Opera Mini). The signed return URL rides on
        // the intent (Phase 6); the SDK only navigates.
        const reason: CheckoutUnresolved["reason"] =
          env.canPopup && win === null ? "popup_blocked" : "redirected";
        onUnresolved?.({ reference, status: "unresolved", reason });
        redirectTo(
          buildCheckoutUrl(checkoutOrigin, {
            reference,
            nonce,
            mode: "redirect",
          }),
        );
      })
      .catch(() => {
        button.setState("ready");
        if (win && !win.closed) win.close();
      });
  };

  const button: ButtonHandle = renderButton(mount, {
    onClick: handleClick,
    onReady,
  });

  return {
    unmount: () => {
      listener?.teardown();
      button.destroy();
      preconnect.remove();
    },
  };
}
