import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountXendButton } from "../index";

const ORIGIN = "https://pay.xend.global";
const API = "https://api.xend.test";

interface FakeWindow {
  location: { href: string };
  closed: boolean;
  close: () => void;
}

function makeFakeWindow(): FakeWindow {
  return { location: { href: "" }, closed: false, close: vi.fn() };
}

function container(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

function shadow(): ShadowRoot {
  const host = document.querySelector("[data-xend-checkout]");
  if (!host?.shadowRoot) throw new Error("sheet is not mounted");
  return host.shadowRoot;
}

function stubSummary(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      merchantDisplayName: "Sabi Market",
      displayCurrency: "NGN",
      displayAmountMinor: "800000",
    }),
  }));
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return fetchMock;
}

// The confirm button arms only after a delay AND a real interaction, so a
// clickjacked sheet cannot be tapped through. Tests have to clear both.
async function armedConfirm(): Promise<HTMLButtonElement> {
  const root = shadow();
  const cta = await vi.waitFor(() => {
    const el = root.querySelector<HTMLButtonElement>("[data-confirm]");
    if (!el) throw new Error("confirm not rendered");
    return el;
  });
  root.dispatchEvent(new Event("pointermove"));
  await vi.waitFor(
    () => {
      if (cta.disabled) throw new Error("confirm not armed");
    },
    { timeout: 2000 },
  );
  return cta;
}

function frame(): HTMLIFrameElement | null {
  return shadow().querySelector("iframe");
}

function postFromFrame(
  nonce: string,
  reference: string,
  origin = ORIGIN,
): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin,
      data: {
        xend: "checkout",
        v: 1,
        nonce,
        reference,
        type: "xend.checkout.result",
        status: "succeeded",
      },
    }),
  );
}

function postReady(nonce: string, origin = ORIGIN): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin,
      data: { xend: "checkout", v: 1, nonce, type: "xend.checkout.ready" },
    }),
  );
}

function stubLocationAssign(): ReturnType<typeof vi.fn> {
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { assign, href: "", origin: ORIGIN },
  });
  return assign;
}

function setUserAgent(ua: string): void {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: ua,
  });
}

let handle: { unmount: () => void } | undefined;
const originalLocation = window.location;
const originalUserAgent = navigator.userAgent;

beforeEach(() => {
  (window as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential =
    function () {};
});

afterEach(() => {
  handle?.unmount();
  handle = undefined;
  document.body.innerHTML = "";
  document.getElementById("xend-pay-style")?.remove();
  document.querySelectorAll("[data-xend-checkout]").forEach((n) => n.remove());
  delete (window as unknown as { PublicKeyCredential?: unknown })
    .PublicKeyCredential;
  setUserAgent(originalUserAgent);
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mountXendButton inline ceremony", () => {
  it("is the default presentation, and confirms into a frame instead of a window", async () => {
    const openSpy = vi.spyOn(window, "open");
    stubSummary();

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      createIntent: () => Promise.resolve({ reference: "pi_inline" }),
      onResult: () => {},
    });
    document.querySelector("button")!.click();
    (await armedConfirm()).click();

    const el = frame();
    expect(el).not.toBeNull();
    expect(openSpy).not.toHaveBeenCalled();

    const url = new URL(el!.src);
    expect(url.origin).toBe(ORIGIN);
    expect(url.searchParams.get("mode")).toBe("iframe");
    expect(url.searchParams.get("intent")).toBe("pi_inline");
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(url.searchParams.get("opener")).toBe(window.location.origin);
  });

  it("carries the permissions policy the passkey ceremony needs, inside a sandbox", async () => {
    vi.spyOn(window, "open");
    stubSummary();

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      createIntent: () => Promise.resolve({ reference: "pi_allow" }),
      onResult: () => {},
    });
    document.querySelector("button")!.click();
    (await armedConfirm()).click();

    const el = frame()!;
    expect(el.getAttribute("allow")).toBe("publickey-credentials-get");
    const sandbox = el.getAttribute("sandbox") ?? "";
    expect(sandbox.split(" ").sort()).toEqual([
      "allow-forms",
      "allow-same-origin",
      "allow-scripts",
    ]);
  });

  it("resolves onResult from the frame's own postMessage", async () => {
    vi.spyOn(window, "open");
    stubSummary();
    const onResult = vi.fn();

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      createIntent: () => Promise.resolve({ reference: "pi_frame_msg" }),
      onResult,
    });
    document.querySelector("button")!.click();
    (await armedConfirm()).click();

    const nonce = new URL(frame()!.src).searchParams.get("nonce")!;
    postFromFrame(nonce, "pi_frame_msg");

    await vi.waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({
        reference: "pi_frame_msg",
        status: "succeeded",
      }),
    );
    expect(shadow().textContent).toContain("Done");
  });

  it("ignores a forged result posted from another origin", async () => {
    vi.spyOn(window, "open");
    stubSummary();
    const onResult = vi.fn();

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      createIntent: () => Promise.resolve({ reference: "pi_forged" }),
      onResult,
    });
    document.querySelector("button")!.click();
    (await armedConfirm()).click();

    const nonce = new URL(frame()!.src).searchParams.get("nonce")!;
    postFromFrame(nonce, "pi_forged", "https://pay.xend.global.evil.test");
    postFromFrame(nonce, "pi_forged", "null");

    expect(onResult).not.toHaveBeenCalled();
    expect(frame()).not.toBeNull();
  });

  it("keeps the frame on the surface's handshake, and resolves nothing from it", async () => {
    const openSpy = vi.spyOn(window, "open");
    stubSummary();
    const onResult = vi.fn();
    const onUnresolved = vi.fn();

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      createIntent: () => Promise.resolve({ reference: "pi_ready" }),
      onResult,
      onUnresolved,
    });
    document.querySelector("button")!.click();
    (await armedConfirm()).click();

    const el = frame()!;
    postReady(new URL(el.src).searchParams.get("nonce")!);

    // The handshake reports liveness and nothing else.
    expect(onResult).not.toHaveBeenCalled();
    expect(onUnresolved).not.toHaveBeenCalled();
    expect(frame()).toBe(el);
    // It also outlives the fallback timeout, which the handshake disarmed.
    el.dispatchEvent(new Event("load"));
    expect(openSpy).not.toHaveBeenCalled();
    expect(frame()).toBe(el);
  });

  it("ignores a handshake from a wrong origin or with a wrong nonce", async () => {
    const fakeWin = makeFakeWindow();
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => fakeWin as unknown as Window);
    stubSummary();

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      createIntent: () => Promise.resolve({ reference: "pi_bad_ready" }),
      onResult: () => {},
    });
    document.querySelector("button")!.click();
    (await armedConfirm()).click();

    const el = frame()!;
    const nonce = new URL(el.src).searchParams.get("nonce")!;
    postReady(nonce, "https://pay.xend.global.evil.test");
    postReady(nonce, "null");
    postReady("n_not_ours");

    // Nothing disarmed the fallback, so the frame still gives way.
    el.dispatchEvent(new Event("load"));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(frame()).toBeNull();
  });

  it("resolves exactly once when the surface handshakes and then reports a result", async () => {
    const openSpy = vi.spyOn(window, "open");
    stubSummary();
    const onResult = vi.fn();

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      createIntent: () => Promise.resolve({ reference: "pi_ready_result" }),
      onResult,
    });
    document.querySelector("button")!.click();
    (await armedConfirm()).click();

    const nonce = new URL(frame()!.src).searchParams.get("nonce")!;
    postReady(nonce);
    postFromFrame(nonce, "pi_ready_result");
    postFromFrame(nonce, "pi_ready_result");

    await vi.waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({
        reference: "pi_ready_result",
        status: "succeeded",
      }),
    );
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(openSpy).not.toHaveBeenCalled();
    expect(shadow().textContent).toContain("Done");
  });

  it("hands over to the popup the moment a refused frame settles, without waiting out the timeout", async () => {
    const fakeWin = makeFakeWindow();
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => fakeWin as unknown as Window);
    stubSummary();

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      createIntent: () => Promise.resolve({ reference: "pi_refused_fast" }),
      onResult: () => {},
    });
    document.querySelector("button")!.click();
    (await armedConfirm()).click();

    // A frame the checkout refused to be embedded in never leaves about:blank,
    // so it stays readable from here after it settles.
    frame()!.dispatchEvent(new Event("load"));

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(frame()).toBeNull();
    expect(shadow().textContent).toContain("Finish in the Xend window");
  });

  it("falls back on the timeout alone for a surface that never handshakes", async () => {
    const fakeWin = makeFakeWindow();
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => fakeWin as unknown as Window);
    stubSummary();
    const onResult = vi.fn();

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      createIntent: () => Promise.resolve({ reference: "pi_refused" }),
      onResult,
    });
    document.querySelector("button")!.click();
    (await armedConfirm()).click();

    const frameNonce = new URL(frame()!.src).searchParams.get("nonce")!;
    expect(openSpy).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1), {
      timeout: 4000,
    });

    // The sheet is the popup sheet again, with the same nonce and reference.
    expect(frame()).toBeNull();
    expect(shadow().textContent).toContain("Finish in the Xend window");
    const launched = new URL(String(openSpy.mock.calls[0]![0]));
    expect(launched.searchParams.get("nonce")).toBe(frameNonce);
    expect(launched.searchParams.get("mode")).toBe("popup");
    const navUrl = new URL(fakeWin.location.href);
    expect(navUrl.searchParams.get("intent")).toBe("pi_refused");
    expect(navUrl.searchParams.get("nonce")).toBe(frameNonce);

    postFromFrame(frameNonce, "pi_refused");
    await vi.waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({
        reference: "pi_refused",
        status: "succeeded",
      }),
    );
  }, 8000);

  it("redirects rather than stranding the shopper when the fallback popup is blocked too", async () => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    stubSummary();
    const onUnresolved = vi.fn();

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      createIntent: () => Promise.resolve({ reference: "pi_frame_blocked" }),
      onResult: () => {},
      onUnresolved,
    });
    document.querySelector("button")!.click();
    const cta = await armedConfirm();
    cta.click();
    const frameNonce = new URL(frame()!.src).searchParams.get("nonce")!;
    const assign = stubLocationAssign();

    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1), {
      timeout: 4000,
    });
    const url = new URL(String(assign.mock.calls[0]![0]));
    expect(url.searchParams.get("mode")).toBe("redirect");
    expect(url.searchParams.get("intent")).toBe("pi_frame_blocked");
    expect(url.searchParams.get("nonce")).toBe(frameNonce);
    expect(onUnresolved).toHaveBeenCalledWith({
      reference: "pi_frame_blocked",
      status: "unresolved",
      reason: "popup_blocked",
    });
  }, 8000);

  it("never builds a frame in an in-app browser", async () => {
    setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Instagram 300.0",
    );
    const openSpy = vi.spyOn(window, "open");
    stubSummary();
    const assign = stubLocationAssign();

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      createIntent: () => Promise.resolve({ reference: "pi_webview" }),
      onResult: () => {},
    });
    document.querySelector("button")!.click();

    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(document.querySelector("[data-xend-checkout]")).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
    expect(String(assign.mock.calls[0]![0])).toContain("mode=redirect");
  });

  it("cancels once and drops the listener when the sheet is dismissed mid-ceremony", async () => {
    vi.spyOn(window, "open");
    stubSummary();
    const onResult = vi.fn();

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      createIntent: () => Promise.resolve({ reference: "pi_frame_cancel" }),
      onResult,
    });
    document.querySelector("button")!.click();
    (await armedConfirm()).click();
    const nonce = new URL(frame()!.src).searchParams.get("nonce")!;

    shadow().querySelector<HTMLElement>("[data-close]")!.click();

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith({
      reference: "pi_frame_cancel",
      status: "canceled",
    });

    postFromFrame(nonce, "pi_frame_cancel");
    expect(onResult).toHaveBeenCalledTimes(1);
  });
});
