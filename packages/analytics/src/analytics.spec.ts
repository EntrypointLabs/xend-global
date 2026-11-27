import { describe, expect, it, vi } from "vitest";
import {
  bucketAmount,
  createAnalytics,
  errorReason,
  routeToScreenName,
  sanitize,
} from "./index";

describe("sanitize", () => {
  it("drops keys named like personal or money data", () => {
    expect(
      sanitize({
        email: "a@b.co",
        wallet_address: "x",
        amount: 12,
        recipient_name: "Ada",
        amount_bucket: "10-50",
        token: "USDC",
      }),
    ).toEqual({ amount_bucket: "10-50", token: "USDC" });
  });

  it("drops values shaped like emails, addresses and account numbers", () => {
    expect(
      sanitize({
        reason: "failed for ada@example.com",
        rail: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
        step: "acct 0123456789",
        ok: "bank",
      }),
    ).toEqual({ ok: "bank" });
  });

  it("keeps primitives only and trims long strings", () => {
    const out = sanitize({
      a: { nested: 1 },
      b: [1],
      c: NaN,
      d: "ab ".repeat(70),
    });
    expect(out).toEqual({ d: "ab ".repeat(70).slice(0, 80) });
  });
});

describe("errorReason", () => {
  it("prefers a code, then status, then name", () => {
    expect(errorReason({ code: "INSUFFICIENT_FUNDS" })).toBe(
      "insufficient_funds",
    );
    expect(errorReason({ status: 502, message: "rent" })).toBe("http_502");
    expect(errorReason(new TypeError("boom"))).toBe("typeerror");
    expect(errorReason(new Error("send to ada@example.com failed"))).toBe(
      "error",
    );
  });
});

describe("bucketAmount", () => {
  it("ranges USD and NGN on their own ladders", () => {
    expect(bucketAmount(0)).toBe("0");
    expect(bucketAmount(0.5)).toBe("<1");
    expect(bucketAmount("25")).toBe("10-50");
    expect(bucketAmount(2_500)).toBe("1k-5k");
    expect(bucketAmount(50_000)).toBe("10k+");
    expect(bucketAmount(20_000, "NGN")).toBe("10k-50k");
    expect(bucketAmount(-1)).toBeUndefined();
    expect(bucketAmount("abc")).toBeUndefined();
  });
});

describe("routeToScreenName", () => {
  it("removes groups and index from expo-router segments", () => {
    expect(routeToScreenName(["(tabs)", "settings", "index"])).toBe(
      "/settings",
    );
    expect(routeToScreenName(["(tabs)"])).toBe("/");
    expect(routeToScreenName(["token", "[mint]"])).toBe("/token/[mint]");
  });

  it("replaces dynamic path parts with their param names", () => {
    expect(routeToScreenName("/orders/ord_123", { id: "ord_123" })).toBe(
      "/orders/[id]",
    );
  });
});

describe("createAnalytics", () => {
  it("adds the app, sanitizes, and never throws from the transport", () => {
    const capture = vi.fn(() => {
      throw new Error("network");
    });
    const analytics = createAnalytics({
      app: "mobile",
      transport: {
        capture,
        screen: vi.fn(),
        identify: vi.fn(),
        reset: vi.fn(),
      },
    });
    expect(() =>
      analytics.track("send_failed", { rail: "wallet", reason: "x@y.io" }),
    ).not.toThrow();
    expect(capture).toHaveBeenCalledWith("send_failed", {
      rail: "wallet",
      app: "mobile",
    });
  });

  it("identifies once per user until reset", () => {
    const identify = vi.fn();
    const analytics = createAnalytics({
      app: "mobile",
      transport: {
        capture: vi.fn(),
        screen: vi.fn(),
        identify,
        reset: vi.fn(),
      },
    });
    analytics.identify("u1");
    analytics.identify("u1");
    analytics.reset();
    analytics.identify("u1");
    expect(identify).toHaveBeenCalledTimes(2);
  });
});
