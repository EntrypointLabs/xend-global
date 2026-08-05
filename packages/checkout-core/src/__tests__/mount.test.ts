import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountXendButton } from "../index";

const ORIGIN = "https://pay.xend.global";

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

// jsdom's window.location.assign is non-configurable, so replace the whole
// location object with a stub for the redirect assertions.
function stubLocationAssign(): ReturnType<typeof vi.fn> {
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { assign, href: "", origin: ORIGIN },
  });
  return assign;
}

let handle: { unmount: () => void } | undefined;
const originalLocation = window.location;

beforeEach(() => {
  // Give jsdom WebAuthn so detectEnvironment picks the popup flow.
  (window as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential =
    function () {};
});

afterEach(() => {
  handle?.unmount();
  handle = undefined;
  document.body.innerHTML = "";
  document.getElementById("xend-pay-style")?.remove();
  delete (window as unknown as { PublicKeyCredential?: unknown })
    .PublicKeyCredential;
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
  vi.restoreAllMocks();
});

describe("mountXendButton sync-open handshake", () => {
  it("opens the popup synchronously (intent-less) before awaiting createIntent, then navigates it", async () => {
    const fakeWin = makeFakeWindow();
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => fakeWin as unknown as Window);

    let resolveIntent!: (v: { reference: string }) => void;
    const createIntent = vi.fn(
      () =>
        new Promise<{ reference: string }>((resolve) => {
          resolveIntent = resolve;
        }),
    );

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      createIntent,
      onResult: () => {},
    });

    document.querySelector("button")!.click();

    // Synchronous assertions BEFORE any microtask flush.
    expect(openSpy).toHaveBeenCalledTimes(1);
    const openedUrl = String(openSpy.mock.calls[0]![0]);
    expect(openedUrl).toContain("nonce=");
    expect(openedUrl).toContain("mode=popup");
    expect(openedUrl).not.toContain("intent=");

    // window.open happened before createIntent was called.
    expect(openSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      createIntent.mock.invocationCallOrder[0]!,
    );

    // The nonce we opened with, to prove it is threaded through unchanged.
    const openedNonce = new URL(openedUrl).searchParams.get("nonce")!;

    resolveIntent({ reference: "pi_ref_42" });
    await vi.waitFor(() => expect(fakeWin.location.href).not.toBe(""));

    const navUrl = new URL(fakeWin.location.href);
    expect(navUrl.searchParams.get("intent")).toBe("pi_ref_42");
    expect(navUrl.searchParams.get("nonce")).toBe(openedNonce);
    expect(navUrl.searchParams.get("mode")).toBe("popup");
  });

  it("falls back to a redirect with mode=redirect when the popup is blocked", async () => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    const assign = stubLocationAssign();
    const onUnresolved = vi.fn();

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      createIntent: () => Promise.resolve({ reference: "pi_ref_blocked" }),
      onResult: () => {},
      onUnresolved,
    });

    document.querySelector("button")!.click();

    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const url = new URL(String(assign.mock.calls[0]![0]));
    expect(url.searchParams.get("mode")).toBe("redirect");
    expect(url.searchParams.get("intent")).toBe("pi_ref_blocked");
    expect(onUnresolved).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "popup_blocked",
        status: "unresolved",
      }),
    );
  });

  it("takes the redirect path in a webview without opening a popup", async () => {
    // No WebAuthn -> detectEnvironment returns canPopup:false.
    delete (window as unknown as { PublicKeyCredential?: unknown })
      .PublicKeyCredential;
    const openSpy = vi.spyOn(window, "open");
    const assign = stubLocationAssign();
    const onUnresolved = vi.fn();

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      createIntent: () => Promise.resolve({ reference: "pi_ref_wv" }),
      onResult: () => {},
      onUnresolved,
    });

    document.querySelector("button")!.click();

    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(openSpy).not.toHaveBeenCalled();
    const url = new URL(String(assign.mock.calls[0]![0]));
    expect(url.searchParams.get("mode")).toBe("redirect");
    expect(onUnresolved).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "redirected" }),
    );
  });
});
