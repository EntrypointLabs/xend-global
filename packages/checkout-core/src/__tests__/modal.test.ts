import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountXendButton } from "../index";

const ORIGIN = "https://pay.xend.global";
const API = "https://api.xend.test";

function container(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

function sheetText(): string {
  return (
    document.querySelector("[data-xend-checkout]")?.shadowRoot?.textContent ??
    ""
  );
}

let handle: { unmount: () => void } | undefined;

beforeEach(() => {
  // Give jsdom WebAuthn so the environment is treated as a real browser.
  (window as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential =
    function () {};
});

afterEach(() => {
  handle?.unmount();
  handle = undefined;
  document.body.innerHTML = "";
  document.querySelectorAll("[data-xend-checkout]").forEach((n) => n.remove());
  delete (window as unknown as { PublicKeyCredential?: unknown })
    .PublicKeyCredential;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mountXendButton modal presentation", () => {
  it("renders the in-page glass sheet from the checkout summary, without opening a window", async () => {
    const openSpy = vi.spyOn(window, "open");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          merchantDisplayName: "Sabi Market",
          ngnDisplayMinor: "4500000",
        }),
      })) as unknown as typeof fetch,
    );

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      presentation: "modal",
      createIntent: () => Promise.resolve({ reference: "pi_modal_1" }),
      onResult: () => {},
    });
    document.querySelector("button")!.click();

    await vi.waitFor(() => expect(sheetText()).toContain("Sabi Market"));
    // Naira from the pinned minor units; no balance figure is ever rendered.
    expect(sheetText()).toContain("₦45,000");
    expect(sheetText()).toContain("Pay with your Xend balance");
    expect(sheetText()).not.toContain("available");
    // In-page overlay only — never a separate window.
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("falls back to the popup flow when no apiBase is configured", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      presentation: "modal", // requested, but modal needs an apiBase
      createIntent: () => Promise.resolve({ reference: "pi_x" }),
      onResult: () => {},
      onUnresolved: () => {},
    });
    document.querySelector("button")!.click();

    // No apiBase -> not the modal path -> the popup handshake is attempted.
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-xend-checkout]")).toBeNull();
  });
});
