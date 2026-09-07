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

function sheetText(): string {
  return (
    document.querySelector("[data-xend-checkout]")?.shadowRoot?.textContent ??
    ""
  );
}

function stubSummary(
  summary: Record<string, unknown>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => summary,
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
  // Give jsdom WebAuthn so the environment is treated as a real browser.
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
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mountXendButton glass sheet", () => {
  it("is the default presentation, and renders the summary without opening a window", async () => {
    const openSpy = vi.spyOn(window, "open");
    const fetchMock = stubSummary({
      merchantDisplayName: "Sabi Market",
      displayCurrency: "NGN",
      displayAmountMinor: "4500000",
      itemLabel: "1× Founder Hoodie",
    });

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      createIntent: () => Promise.resolve({ reference: "pi_sheet_1" }),
      onResult: () => {},
    });
    document.querySelector("button")!.click();

    await vi.waitFor(() => expect(sheetText()).toContain("Sabi Market"));
    // The amount comes from displayAmountMinor in the intent's own currency.
    expect(sheetText()).toContain("₦45,000");
    expect(sheetText()).toContain("1× Founder Hoodie");
    expect(sheetText()).toContain("Pay with your Xend balance");
    // No balance figure is ever rendered on the merchant page.
    expect(sheetText()).not.toContain("available");
    expect(openSpy).not.toHaveBeenCalled();

    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe(
      `${API}/checkout/intents/pi_sheet_1`,
    );
    expect(url.searchParams.get("opener")).toBe(window.location.origin);
    // Anonymous read: a host-only session cookie cannot travel cross-site.
    expect(fetchMock.mock.calls[0]![1]).toBeUndefined();
  });

  it("prices a dollar order in the settlement asset's own decimals", async () => {
    vi.spyOn(window, "open");
    stubSummary({
      merchantDisplayName: "Acme",
      displayCurrency: "USDC",
      displayAmountMinor: "25000000",
    });

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      createIntent: () => Promise.resolve({ reference: "pi_usdc" }),
      onResult: () => {},
    });
    document.querySelector("button")!.click();

    await vi.waitFor(() => expect(sheetText()).toContain("$25"));
    expect(sheetText()).not.toContain("$250,000");
  });

  it("opens the checkout popup from the confirm click instead of authorizing itself", async () => {
    const fakeWin = makeFakeWindow();
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => fakeWin as unknown as Window);
    const fetchMock = stubSummary({
      merchantDisplayName: "Sabi Market",
      displayCurrency: "NGN",
      displayAmountMinor: "800000",
    });

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      createIntent: () => Promise.resolve({ reference: "pi_confirm" }),
      onResult: () => {},
    });
    document.querySelector("button")!.click();
    (await armedConfirm()).click();

    // Synchronous open with the intent-less handshake URL, then the navigation.
    expect(openSpy).toHaveBeenCalledTimes(1);
    const launched = new URL(String(openSpy.mock.calls[0]![0]));
    expect(launched.searchParams.get("mode")).toBe("popup");
    expect(launched.searchParams.get("intent")).toBeNull();
    expect(launched.searchParams.get("opener")).toBe(window.location.origin);

    const navUrl = new URL(fakeWin.location.href);
    expect(navUrl.searchParams.get("intent")).toBe("pi_confirm");
    expect(navUrl.searchParams.get("nonce")).toBe(
      launched.searchParams.get("nonce"),
    );
    expect(navUrl.searchParams.get("mode")).toBe("popup");

    // The sheet waits on the ceremony; it never calls the API itself.
    expect(sheetText()).toContain("Finish in the Xend window");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("/checkout/authorize");
    }
  });

  it("resolves onResult from the checkout's own postMessage", async () => {
    const fakeWin = makeFakeWindow();
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => fakeWin as unknown as Window);
    stubSummary({
      merchantDisplayName: "Sabi Market",
      displayCurrency: "NGN",
      displayAmountMinor: "800000",
    });
    const onResult = vi.fn();

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      createIntent: () => Promise.resolve({ reference: "pi_msg" }),
      onResult,
    });
    document.querySelector("button")!.click();
    (await armedConfirm()).click();

    const nonce = new URL(String(openSpy.mock.calls[0]![0])).searchParams.get(
      "nonce",
    )!;
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: ORIGIN,
        data: {
          xend: "checkout",
          v: 1,
          nonce,
          reference: "pi_msg",
          type: "xend.checkout.result",
          status: "succeeded",
        },
      }),
    );

    await vi.waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({
        reference: "pi_msg",
        status: "succeeded",
      }),
    );
    expect(sheetText()).toContain("Done");
  });

  it("falls back to the redirect flow when the popup is blocked at confirm", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    stubSummary({
      merchantDisplayName: "Sabi Market",
      displayCurrency: "NGN",
      displayAmountMinor: "800000",
    });
    const onUnresolved = vi.fn();

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      createIntent: () => Promise.resolve({ reference: "pi_blocked" }),
      onResult: () => {},
      onUnresolved,
    });
    document.querySelector("button")!.click();
    const cta = await armedConfirm();
    const assign = stubLocationAssign();
    cta.click();

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledTimes(1);
    const url = new URL(String(assign.mock.calls[0]![0]));
    expect(url.searchParams.get("mode")).toBe("redirect");
    expect(url.searchParams.get("intent")).toBe("pi_blocked");
    expect(onUnresolved).toHaveBeenCalledWith({
      reference: "pi_blocked",
      status: "unresolved",
      reason: "popup_blocked",
    });
  });

  it("writes merchant strings as text, so markup in them is never parsed", async () => {
    vi.spyOn(window, "open");
    const injected = '<img src=x onerror="window.__xss=1">';
    stubSummary({
      merchantDisplayName: injected,
      displayCurrency: "NGN",
      displayAmountMinor: "800000",
      itemLabel: "</div><script>window.__xss=1</script>",
    });

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      createIntent: () => Promise.resolve({ reference: "pi_xss" }),
      onResult: () => {},
    });
    document.querySelector("button")!.click();

    await vi.waitFor(() => expect(sheetText()).toContain(injected));
    const root = shadow();
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector(".mname")!.innerHTML).not.toContain("<img");
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });

  it("cancels cleanly when the sheet is dismissed, and reports it once", async () => {
    const fakeWin = makeFakeWindow();
    vi.spyOn(window, "open").mockImplementation(
      () => fakeWin as unknown as Window,
    );
    stubSummary({
      merchantDisplayName: "Sabi Market",
      displayCurrency: "NGN",
      displayAmountMinor: "800000",
    });
    const onResult = vi.fn();

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      createIntent: () => Promise.resolve({ reference: "pi_cancel" }),
      onResult,
    });
    document.querySelector("button")!.click();
    (await armedConfirm()).click();

    shadow().querySelector<HTMLElement>("[data-close]")!.click();

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith({
      reference: "pi_cancel",
      status: "canceled",
    });
    expect(fakeWin.close).toHaveBeenCalled();

    // The listener is gone: a late result cannot reopen a settled payment.
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: ORIGIN,
        data: {
          xend: "checkout",
          v: 1,
          nonce: "n",
          reference: "pi_cancel",
          type: "xend.checkout.result",
          status: "succeeded",
        },
      }),
    );
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("shows the sheet's loading state, not an error, while the intent is being created", async () => {
    vi.spyOn(window, "open");
    stubSummary({
      merchantDisplayName: "Sabi Market",
      displayCurrency: "NGN",
      displayAmountMinor: "800000",
    });
    let resolveIntent!: (v: { reference: string }) => void;

    handle = mountXendButton({
      mount: container(),
      checkoutOrigin: ORIGIN,
      apiBase: API,
      createIntent: () =>
        new Promise<{ reference: string }>((r) => {
          resolveIntent = r;
        }),
      onResult: () => {},
    });
    document.querySelector("button")!.click();

    expect(sheetText()).toContain("Getting your payment ready");
    expect(sheetText()).not.toContain("Something went wrong");

    resolveIntent({ reference: "pi_late" });
    await vi.waitFor(() => expect(sheetText()).toContain("Sabi Market"));
  });
});
