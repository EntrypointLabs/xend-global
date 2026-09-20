// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { navigate, pagePath, paymentPath, routeFor } from "./router";

afterEach(() => {
  window.history.pushState(null, "", "/");
});

describe("routeFor", () => {
  it("maps known paths to pages", () => {
    expect(routeFor("/")).toEqual({ page: "overview" });
    expect(routeFor("/payments")).toEqual({ page: "payments" });
    expect(routeFor("/developers")).toEqual({ page: "developers" });
    expect(routeFor("/webhooks")).toEqual({ page: "webhooks" });
    expect(routeFor("/account")).toEqual({ page: "account" });
    expect(routeFor("/audit")).toEqual({ page: "audit" });
  });

  it("extracts the payment id from a detail path", () => {
    expect(routeFor("/payments/pi_abc123")).toEqual({
      page: "payment",
      paymentId: "pi_abc123",
    });
  });

  it("decodes an encoded payment id and tolerates a trailing slash", () => {
    expect(routeFor(paymentPath("pi_a/b"))).toEqual({
      page: "payment",
      paymentId: "pi_a/b",
    });
    expect(routeFor("/payments/")).toEqual({ page: "payments" });
  });

  it("falls back to the overview for an unknown path", () => {
    expect(routeFor("/nope")).toEqual({ page: "overview" });
  });

  it("does not throw on a malformed payment path, falling back to the list", () => {
    expect(() => routeFor("/payments/%")).not.toThrow();
    expect(routeFor("/payments/%")).toEqual({ page: "payments" });
  });
});

describe("navigate", () => {
  it("pushes a new path and updates the location", () => {
    navigate(pagePath("payments"));
    expect(window.location.pathname).toBe("/payments");
  });
});
