// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { useMerchantDashboard } from "./useMerchantDashboard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Merchant account loading", () => {
  it("loads a returning Merchant without a second button press", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ name: "Chowderr" }),
    });
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() =>
      useMerchantDashboard<{ name: string }>("test-token"),
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data?.name).toBe("Chowderr");
  });

  it.each([401, 500])("does not show signup for HTTP %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status }));
    const { result } = renderHook(() => useMerchantDashboard("test-token"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
  });

  it("shows signup only when the account is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    );
    const { result } = renderHook(() => useMerchantDashboard("test-token"));
    await waitFor(() => expect(result.current.status).toBe("missing"));
  });

  it("hides account data as soon as identity is removed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ name: "Chowderr" }),
      }),
    );
    const { result, rerender } = renderHook(
      ({ token }) => useMerchantDashboard(token),
      { initialProps: { token: "test-token" as string | null } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ token: null });
    expect(result.current.data).toBeNull();
  });

  it("keeps the mounted dashboard while a refreshed identity token revalidates", async () => {
    let resolveRefresh!: (value: unknown) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ name: "Draft Merchant", profileVersion: 1 }),
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const { result, rerender } = renderHook(
      ({ token }) =>
        useMerchantDashboard<{ name: string; profileVersion: number }>(token),
      { initialProps: { token: "token-1" } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ token: "token-2" });

    expect(result.current.status).toBe("ready");
    expect(result.current.data?.name).toBe("Draft Merchant");
    resolveRefresh({
      ok: true,
      status: 200,
      json: async () => ({ name: "Draft Merchant", profileVersion: 2 }),
    });
    await waitFor(() => expect(result.current.data?.profileVersion).toBe(2));
  });
});
