import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listenForResult } from "../message-listener";

const ORIGIN = "https://pay.xend.global";
const REFERENCE = "pi_test_123";
const NONCE = "abcdef0123456789";

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    xend: "checkout",
    v: 1,
    nonce: NONCE,
    reference: REFERENCE,
    type: "xend.checkout.result",
    status: "succeeded",
    ...overrides,
  };
}

function post(data: unknown, origin: string): void {
  window.dispatchEvent(new MessageEvent("message", { data, origin }));
}

describe("listenForResult", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts an exact-origin canonical result matching reference and nonce", () => {
    const onResult = vi.fn();
    const handle = listenForResult({
      checkoutOrigin: ORIGIN,
      reference: REFERENCE,
      nonce: NONCE,
      onResult,
    });
    post(envelope(), ORIGIN);
    expect(onResult).toHaveBeenCalledWith({
      reference: REFERENCE,
      status: "succeeded",
    });
    handle.teardown();
  });

  it("resolves a cancel message as status canceled", () => {
    const onResult = vi.fn();
    const handle = listenForResult({
      checkoutOrigin: ORIGIN,
      reference: REFERENCE,
      nonce: NONCE,
      onResult,
    });
    post(
      envelope({ type: "xend.checkout.cancel", status: "canceled" }),
      ORIGIN,
    );
    expect(onResult).toHaveBeenCalledWith({
      reference: REFERENCE,
      status: "canceled",
    });
    handle.teardown();
  });

  it.each([
    ["substring-spoofed origin", ORIGIN, "https://pay.xend.global.evil.com"],
    ["prefix-spoofed origin", ORIGIN, "https://evil.pay.xend.global"],
    ["null origin", ORIGIN, "null"],
  ])("rejects %s", (_name, _expected, spoofOrigin) => {
    const onResult = vi.fn();
    const handle = listenForResult({
      checkoutOrigin: ORIGIN,
      reference: REFERENCE,
      nonce: NONCE,
      onResult,
    });
    post(envelope(), spoofOrigin);
    expect(onResult).not.toHaveBeenCalled();
    handle.teardown();
  });

  it.each([
    ["mismatched reference", envelope({ reference: "pi_other" })],
    ["mismatched nonce", envelope({ nonce: "deadbeef" })],
    ["unknown protocol version", envelope({ v: 2 })],
    ["wrong xend discriminant", envelope({ xend: "notcheckout" })],
    ["bare (non-namespaced) type", envelope({ type: "result" })],
  ])("ignores %s", (_name, data) => {
    const onResult = vi.fn();
    const handle = listenForResult({
      checkoutOrigin: ORIGIN,
      reference: REFERENCE,
      nonce: NONCE,
      onResult,
    });
    post(data, ORIGIN);
    expect(onResult).not.toHaveBeenCalled();
    handle.teardown();
  });

  it("resolves onUnresolved(popup_closed) when the popup closes before a result", () => {
    const onResult = vi.fn();
    const onUnresolved = vi.fn();
    const popup = { closed: false } as unknown as Window;
    const handle = listenForResult({
      checkoutOrigin: ORIGIN,
      reference: REFERENCE,
      nonce: NONCE,
      onResult,
      onUnresolved,
      popup,
    });
    (popup as { closed: boolean }).closed = true;
    vi.advanceTimersByTime(500);
    expect(onResult).not.toHaveBeenCalled();
    expect(onUnresolved).toHaveBeenCalledWith({
      reference: REFERENCE,
      status: "unresolved",
      reason: "popup_closed",
    });
    handle.teardown();
  });
});
