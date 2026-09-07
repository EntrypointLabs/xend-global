import { renderButton, type ButtonHandle } from "./button";
import { detectEnvironment } from "./environment";
import { listenForResult, type ListenHandle } from "./message-listener";
import { openModal, type CheckoutSummary, type ModalHandle } from "./modal";
import {
  buildCheckoutUrl,
  generateNonce,
  navigatePopup,
  openCheckoutWindow,
  openerOrigin,
  redirectTo,
} from "./popup";
import type {
  ButtonTheme,
  CheckoutPresentation,
  CheckoutResult,
  CheckoutStatus,
  CheckoutUnresolved,
  XendButtonConfig,
} from "./types";

export type {
  ButtonTheme,
  CheckoutPresentation,
  CheckoutResult,
  CheckoutStatus,
  CheckoutSummary,
  CheckoutUnresolved,
  XendButtonConfig,
};

export interface XendButtonHandle {
  unmount: () => void;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function assertHttpsOrigin(origin: string): void {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`checkoutOrigin must be a valid URL, got: ${origin}`);
  }
  // https everywhere, with an http carve-out for loopback hosts so a checkout
  // running on a local dev server can be integrated against without TLS.
  const httpLoopback = url.protocol === "http:" && isLoopbackHost(url.hostname);
  if (url.protocol !== "https:" && !httpLoopback) {
    throw new Error(
      `checkoutOrigin must be https (http allowed only for localhost), got: ${origin}`,
    );
  }
  if (url.origin !== origin.replace(/\/$/, "")) {
    throw new Error(
      `checkoutOrigin must be a bare origin (no path), got: ${origin}`,
    );
  }
}

/** Script-tag callers are untyped, so an unrecognised value opens the popup. */
function resolvePresentation(value: unknown): CheckoutPresentation {
  if (value === undefined || value === null) return "modal";
  if (value === "modal" || value === "popup" || value === "redirect") {
    return value;
  }
  return "popup";
}

/**
 * The sheet reads the intent summary anonymously. The checkout session cookie
 * is host-only on the API origin and never travels from a merchant page, so
 * asking for credentials would buy nothing and fail every preflight.
 */
async function fetchSummary(
  apiBase: string,
  reference: string,
  opener?: string,
): Promise<CheckoutSummary> {
  const url = new URL(
    `checkout/intents/${encodeURIComponent(reference)}`,
    apiBase.endsWith("/") ? apiBase : `${apiBase}/`,
  );
  if (opener) url.searchParams.set("opener", opener);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`summary ${res.status}`);
  return (await res.json()) as CheckoutSummary;
}

/**
 * Mount the Pay with Xend button.
 *
 * The default "modal" presentation draws the glass sheet on the merchant page
 * and opens the hosted checkout underneath it when the shopper taps Pay: the
 * sheet is the interface, the window is the ceremony, and the passkey never
 * leaves Xend's origin. "popup" skips the sheet and opens that window straight
 * from the button. Either way the window is opened SYNCHRONOUSLY in the click
 * handler with the intent-less URL, before any awaited work, so iOS Safari does
 * not block it. In a webview / Opera Mini / when the popup is blocked, the flow
 * falls back to a full-page redirect.
 */
export function mountXendButton(config: XendButtonConfig): XendButtonHandle {
  const {
    checkoutOrigin,
    createIntent,
    mount,
    onResult,
    onUnresolved,
    onReady,
    apiBase,
    theme = "auto",
  } = config;
  assertHttpsOrigin(checkoutOrigin);
  const presentation = resolvePresentation(config.presentation);
  if (config.presentation === "modal" && !apiBase) {
    console.warn(
      '[xend-checkout] presentation "modal" needs an apiBase to read the intent summary; opening the popup instead.',
    );
  }
  const useSheet =
    presentation === "modal" && !!apiBase && detectEnvironment().canPopup;

  const doc = mount.ownerDocument;
  const view = doc.defaultView;
  const preconnect = doc.createElement("link");
  preconnect.rel = "preconnect";
  preconnect.href = checkoutOrigin;
  doc.head.appendChild(preconnect);

  let listener: ListenHandle | undefined;
  let sheet: ModalHandle | undefined;

  const goRedirect = (
    reference: string,
    nonce: string,
    opener: string | undefined,
    reason: CheckoutUnresolved["reason"],
  ): void => {
    onUnresolved?.({ reference, status: "unresolved", reason });
    redirectTo(
      buildCheckoutUrl(checkoutOrigin, {
        reference,
        nonce,
        mode: "redirect",
        opener,
      }),
    );
  };

  const handleClick = (): void => {
    // Synchronous, in exact order: nonce, then window.open, BEFORE any await.
    const nonce = generateNonce();
    const opener = openerOrigin();
    // "modal" lands here when the sheet could not be used (no apiBase, or a
    // webview); only an explicit "redirect" skips the popup outright.
    const wantPopup =
      presentation !== "redirect" && detectEnvironment().canPopup;
    const win = wantPopup
      ? openCheckoutWindow(checkoutOrigin, nonce, opener)
      : null;
    const usePopup = wantPopup && win !== null;

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
              opener,
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

        // Redirect: asked for, or forced by a blocked popup or an environment
        // where a popup is unsafe (webview / Opera Mini). The signed return
        // URL rides on the intent (Phase 6); the SDK only navigates.
        goRedirect(
          reference,
          nonce,
          opener,
          wantPopup && win === null ? "popup_blocked" : "redirected",
        );
      })
      .catch(() => {
        button.setState("ready");
        if (win && !win.closed) win.close();
      });
  };

  const handleSheetClick = (): void => {
    let reference = "";
    let settled = false;
    let popup: Window | null = null;

    function dropListener(): void {
      listener?.teardown();
      listener = undefined;
    }

    function finish(status: CheckoutStatus): void {
      settled = true;
      dropListener();
      button.setState("ready");
      sheet?.showResult(status);
      onResult({ reference, status });
      if (status === "succeeded") view?.setTimeout(() => sheet?.close(), 1600);
    }

    function handleCancel(): void {
      dropListener();
      sheet?.close();
      button.setState("ready");
      if (popup && !popup.closed) popup.close();
      // A terminal result was already reported; dismissing the sheet afterwards
      // must not report a second, contradictory onResult.
      if (settled) return;
      settled = true;
      onResult({ reference, status: "canceled" });
    }

    function handleConfirm(): void {
      // Still inside the shopper's click: nonce, then window.open, no await.
      const nonce = generateNonce();
      const opener = openerOrigin();
      const canPopup = detectEnvironment().canPopup;
      popup = canPopup
        ? openCheckoutWindow(checkoutOrigin, nonce, opener)
        : null;
      if (!popup) {
        settled = true;
        sheet?.close();
        goRedirect(
          reference,
          nonce,
          opener,
          canPopup ? "popup_blocked" : "redirected",
        );
        return;
      }
      navigatePopup(
        popup,
        buildCheckoutUrl(checkoutOrigin, {
          reference,
          nonce,
          mode: "popup",
          opener,
        }),
      );
      sheet?.showWaiting();
      listener = listenForResult({
        checkoutOrigin,
        reference,
        nonce,
        popup,
        onResult: (result) => finish(result.status),
        onUnresolved: (u) => {
          settled = true;
          dropListener();
          sheet?.close();
          button.setState("ready");
          onUnresolved?.(u);
        },
      });
    }

    sheet = openModal({
      doc,
      theme,
      onConfirm: handleConfirm,
      onCancel: handleCancel,
    });
    sheet.showLoading();
    button.setState("processing");

    const opener = openerOrigin();
    createIntent()
      .then(async ({ reference: r }) => {
        reference = r;
        const summary = await fetchSummary(apiBase as string, r, opener);
        if (summary.expiresAt && Date.parse(summary.expiresAt) <= Date.now()) {
          finish("expired");
          return;
        }
        sheet?.showConfirm(summary);
        button.setState("ready");
      })
      .catch(() => {
        sheet?.showError("We couldn't start the payment.");
        button.setState("ready");
      });
  };

  const button: ButtonHandle = renderButton(mount, {
    onClick: useSheet ? handleSheetClick : handleClick,
    onReady,
    theme,
  });

  return {
    unmount: () => {
      listener?.teardown();
      sheet?.close();
      button.destroy();
      preconnect.remove();
    },
  };
}
