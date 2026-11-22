import { renderButton, type ButtonHandle } from "./button";
import { detectEnvironment } from "./environment";
import { listenForResult, type ListenHandle } from "./message-listener";
import {
  openModal,
  resolveTheme,
  type CheckoutSummary,
  type ModalHandle,
} from "./modal";
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
  PryddButtonConfig,
} from "./types";

export type {
  ButtonTheme,
  CheckoutPresentation,
  CheckoutResult,
  CheckoutStatus,
  CheckoutSummary,
  CheckoutUnresolved,
  PryddButtonConfig,
};

export interface PryddButtonHandle {
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

export const DEFAULT_CHECKOUT_URL = "https://prydd.co/pay";
export const DEFAULT_API_BASE = "https://api.prydd.co";

/**
 * The checkout is served under a path on prydd.co because passkeys made in the
 * Prydd app belong to prydd.co, and the browser only offers them to pages on
 * that host. Messages are still matched against its origin alone.
 */
function resolveCheckoutUrl(value: string): { url: string; origin: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`checkoutUrl must be a valid URL, got: ${value}`);
  }
  // https everywhere, with an http carve-out for loopback hosts so a checkout
  // running on a local dev server can be integrated against without TLS.
  const httpLoopback = url.protocol === "http:" && isLoopbackHost(url.hostname);
  if (url.protocol !== "https:" && !httpLoopback) {
    throw new Error(
      `checkoutUrl must be https (http allowed only for localhost), got: ${value}`,
    );
  }
  if (url.search || url.hash) {
    throw new Error(
      `checkoutUrl must not carry a query or fragment, got: ${value}`,
    );
  }
  const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return { url: `${url.origin}${path}`, origin: url.origin };
}

/**
 * How long the inline frame gets to announce itself before the popup takes
 * over. The ceiling is the browser's transient activation window, roughly five
 * seconds, because the fallback window.open runs from this timer and has to
 * still count as coming from the shopper's tap.
 */
const FRAME_HANDSHAKE_MS = 3000;

/**
 * Whether a settled frame actually landed on the checkout. Nothing about a
 * cross-origin frame is observable from out here, and that is exactly the
 * signal: a frame the checkout declined to be embedded in keeps the
 * about:blank it started on, which is same-origin with this page and stays
 * readable, while one that really reached the checkout throws on the same
 * access. Read only when the surface has not announced itself.
 */
function frameReachedCheckout(frame: HTMLIFrameElement): boolean {
  const win = frame.contentWindow;
  if (!win) return false;
  try {
    void win.location.href;
    return false;
  } catch {
    return true;
  }
}

/** Script-tag callers are untyped, so an unrecognised value opens the popup. */
function resolvePresentation(value: unknown): CheckoutPresentation {
  if (value === undefined || value === null) return "modal";
  if (
    value === "iframe" ||
    value === "modal" ||
    value === "popup" ||
    value === "redirect"
  ) {
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
 * Mount the Pay with Prydd button.
 *
 * The default "modal" presentation draws the glass sheet on the merchant page
 * and runs the passkey ceremony in a Prydd window. "iframe" runs it inside the
 * sheet instead, but Prydd's wallet provider refuses to load under a merchant's
 * page, so it only suits pages Prydd itself controls. "popup" skips the sheet.
 * Every window is opened SYNCHRONOUSLY in the click handler with the
 * intent-less URL, before any
 * awaited work, so iOS Safari does not block it. In a webview / Opera Mini /
 * when the popup is blocked, the flow falls back to a full-page redirect.
 */
export function mountPryddButton(config: PryddButtonConfig): PryddButtonHandle {
  const {
    createIntent,
    mount,
    onResult,
    onUnresolved,
    onReady,
    apiBase = DEFAULT_API_BASE,
    theme = "auto",
  } = config;
  const { url: checkoutUrl, origin: checkoutOrigin } = resolveCheckoutUrl(
    config.checkoutUrl ?? DEFAULT_CHECKOUT_URL,
  );
  const presentation = resolvePresentation(config.presentation);
  const wantsSheet = presentation === "iframe" || presentation === "modal";
  if (wantsSheet && config.presentation && !apiBase) {
    console.warn(
      `[prydd-checkout] presentation "${presentation}" needs an apiBase to read the intent summary; opening the popup instead.`,
    );
  }
  const useSheet = wantsSheet && !!apiBase && detectEnvironment().canPopup;

  const doc = mount.ownerDocument;
  const view = doc.defaultView;
  const preconnect = doc.createElement("link");
  preconnect.rel = "preconnect";
  preconnect.href = checkoutOrigin;
  doc.head.appendChild(preconnect);

  let listener: ListenHandle | undefined;
  let sheet: ModalHandle | undefined;
  let frameTimer: number | undefined;

  const disarmFrame = (): void => {
    if (frameTimer === undefined) return;
    view?.clearTimeout(frameTimer);
    frameTimer = undefined;
  };

  const goRedirect = (
    reference: string,
    nonce: string,
    opener: string | undefined,
    reason: CheckoutUnresolved["reason"],
  ): void => {
    onUnresolved?.({ reference, status: "unresolved", reason });
    redirectTo(
      buildCheckoutUrl(checkoutUrl, {
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
    // A sheet presentation lands here when the sheet could not be used (no
    // apiBase, or a webview); only "redirect" skips the popup outright.
    const wantPopup =
      presentation !== "redirect" && detectEnvironment().canPopup;
    const win = wantPopup
      ? openCheckoutWindow(checkoutUrl, nonce, opener)
      : null;
    const usePopup = wantPopup && win !== null;

    button.setState("processing");

    createIntent()
      .then(({ reference }) => {
        if (usePopup && win) {
          navigatePopup(
            win,
            buildCheckoutUrl(checkoutUrl, {
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
              if (!win.closed) win.close();
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
    let cancelAwaitingReference = false;
    let popup: Window | null = null;

    function dropListener(): void {
      listener?.teardown();
      listener = undefined;
    }

    function finish(status: CheckoutStatus): void {
      settled = true;
      disarmFrame();
      dropListener();
      button.setState("ready");
      sheet?.showResult(status);
      onResult({ reference, status });
      if (status === "succeeded") view?.setTimeout(() => sheet?.close(), 1600);
    }

    function handleCancel(): void {
      disarmFrame();
      dropListener();
      sheet?.close();
      button.setState("ready");
      if (popup && !popup.closed) popup.close();
      // A terminal result was already reported; dismissing the sheet afterwards
      // must not report a second, contradictory onResult.
      if (settled) return;
      settled = true;
      // Dismissed while the intent was still being created. Reporting now would
      // name an empty reference, so the cancel waits for the one it belongs to.
      if (!reference) {
        cancelAwaitingReference = true;
        return;
      }
      onResult({ reference, status: "canceled" });
    }

    function runPopup(nonce: string, opener: string | undefined): void {
      const canPopup = detectEnvironment().canPopup;
      popup = canPopup ? openCheckoutWindow(checkoutUrl, nonce, opener) : null;
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
        buildCheckoutUrl(checkoutUrl, {
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
          if (popup && !popup.closed) popup.close();
          onUnresolved?.(u);
        },
      });
    }

    function runFrame(nonce: string, opener: string | undefined): void {
      const frame = sheet?.showFrame(
        buildCheckoutUrl(checkoutUrl, {
          reference,
          nonce,
          mode: "iframe",
          opener,
          theme: resolveTheme(theme, doc),
        }),
      );
      // Three signals, in descending order of certainty. The surface's mount
      // handshake is proof it loaded; the about:blank probe infers the same
      // thing from the browser for a surface deployed before that handshake
      // existed; the timer is the backstop for a frame that never settles at
      // all. Whichever fires, the popup takes over behind an unchanged sheet
      // carrying the same nonce and reference, so nothing is lost by giving up.
      const giveUp = (): void => {
        if (settled || frameTimer === undefined) return;
        disarmFrame();
        dropListener();
        runPopup(nonce, opener);
      };
      frameTimer = view?.setTimeout(giveUp, FRAME_HANDSHAKE_MS);
      frame?.addEventListener("error", giveUp);
      frame?.addEventListener("load", () => {
        if (frameReachedCheckout(frame)) disarmFrame();
        else giveUp();
      });
      listener = listenForResult({
        checkoutOrigin,
        reference,
        nonce,
        onAlive: disarmFrame,
        onResult: (result) => finish(result.status),
        onUnresolved: (u) => {
          settled = true;
          disarmFrame();
          dropListener();
          sheet?.close();
          button.setState("ready");
          onUnresolved?.(u);
        },
      });
    }

    function handleConfirm(): void {
      // Still inside the shopper's click: nonce first, then the frame or the
      // window, before any await.
      const nonce = generateNonce();
      const opener = openerOrigin();
      if (presentation === "iframe" && detectEnvironment().canPopup) {
        runFrame(nonce, opener);
        return;
      }
      runPopup(nonce, opener);
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
        // The shopper dismissed the sheet before this resolved. The intent is
        // real now, so the cancel finally has the reference it belongs to.
        if (cancelAwaitingReference) {
          cancelAwaitingReference = false;
          onResult({ reference, status: "canceled" });
          return;
        }
        if (settled) return;
        const summary = await fetchSummary(apiBase as string, r, opener);
        if (settled) return;
        if (summary.expiresAt && Date.parse(summary.expiresAt) <= Date.now()) {
          finish("expired");
          return;
        }
        button.setState("ready");
        // The embedded surface shows the amount from Prydd's own origin and
        // carries the one tap that starts the passkey, so the sheet goes
        // straight to it rather than asking the shopper to confirm twice.
        if (presentation === "iframe") {
          handleConfirm();
          return;
        }
        sheet?.showConfirm(summary);
      })
      .catch(() => {
        // Nothing to report: no intent was ever created, so there is no
        // reference to name, and the sheet the shopper closed is gone.
        if (settled) return;
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
      disarmFrame();
      listener?.teardown();
      sheet?.close();
      button.destroy();
      preconnect.remove();
    },
  };
}
