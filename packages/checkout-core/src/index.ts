import { renderButton, type ButtonHandle } from "./button";
import { detectEnvironment } from "./environment";
import { listenForResult, type ListenHandle } from "./message-listener";
import { openModal, type CheckoutSummary } from "./modal";
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

async function fetchSummary(
  apiBase: string,
  reference: string,
): Promise<CheckoutSummary> {
  const res = await fetch(
    `${apiBase}/checkout/intents/${encodeURIComponent(reference)}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`summary ${res.status}`);
  return (await res.json()) as CheckoutSummary;
}

async function authorizeIntent(
  apiBase: string,
  reference: string,
): Promise<{ status: CheckoutStatus }> {
  const res = await fetch(`${apiBase}/checkout/authorize`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reference }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    status?: CheckoutStatus;
  };
  return { status: body.status === "succeeded" ? "succeeded" : "failed" };
}

export type {
  CheckoutResult,
  CheckoutStatus,
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
    presentation = "modal",
    apiBase,
    theme = "auto",
    devSimulateAuthorize = false,
  } = config;
  assertHttpsOrigin(checkoutOrigin);

  // Modal (in-page glass sheet) is the default, but it needs an apiBase to
  // fetch the summary and a browser where the ceremony can run. Webviews /
  // Opera Mini / no-WebAuthn fall back to the redirect flow.
  const useModal =
    presentation === "modal" && !!apiBase && detectEnvironment().canPopup;

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

  const handleModalClick = (): void => {
    let reference = "";
    let resolved = false;
    const modal = openModal({
      doc: mount.ownerDocument,
      theme,
      onConfirm: () => doConfirm(),
      onCancel: () => doCancel(),
    });
    const finish = (status: CheckoutStatus): void => {
      resolved = true;
      modal.showResult(status);
      onResult({ reference, status });
      if (status === "succeeded") {
        mount.ownerDocument.defaultView?.setTimeout(() => modal.close(), 1600);
      }
    };
    const doConfirm = (): void => {
      modal.showAuthorizing();
      (devSimulateAuthorize
        ? Promise.resolve({ status: "succeeded" as CheckoutStatus })
        : authorizeIntent(apiBase as string, reference)
      )
        .then(({ status }) => finish(status))
        .catch(() => modal.showError("We couldn't complete the payment."));
    };
    const doCancel = (): void => {
      modal.close();
      // A terminal result (succeeded/failed/expired) was already reported via
      // finish(); dismissing afterwards (scrim click, "Close" button) must not
      // report a second, contradictory onResult.
      if (!resolved) onResult({ reference, status: "canceled" });
    };
    modal.showLoading();
    button.setState("processing");
    createIntent()
      .then(async ({ reference: r }) => {
        reference = r;
        modal.showConfirm(await fetchSummary(apiBase as string, reference));
        button.setState("ready");
      })
      .catch(() => {
        modal.showError("We couldn't start the payment.");
        button.setState("ready");
      });
  };

  const button: ButtonHandle = renderButton(mount, {
    onClick: useModal ? handleModalClick : handleClick,
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
