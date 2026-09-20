// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { AuditPanel } from "./AuditPanel";
import type { PortalClient } from "./portal";

afterEach(cleanup);

describe("AuditPanel", () => {
  it("renders known actions with friendly labels and metadata", async () => {
    const get = vi.fn().mockResolvedValue({
      entries: [
        {
          id: "a1",
          action: "api_key.issue",
          target: "k1",
          metadata: { mode: "test" },
          at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "a2",
          action: "kyb.submit",
          target: "m1",
          metadata: null,
          at: "2026-01-02T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
    const client = { get, post: vi.fn() } as unknown as PortalClient;
    render(<AuditPanel client={client} />);
    await waitFor(() =>
      expect(screen.getByText("API key created")).toBeTruthy(),
    );
    expect(screen.getByText("Verification submitted")).toBeTruthy();
    expect(screen.getByText("Mode: test")).toBeTruthy();
    // An entry without metadata still names the object it touched.
    expect(screen.getByText("m1")).toBeTruthy();
  });

  it("shows an empty state when there is no activity", async () => {
    const get = vi.fn().mockResolvedValue({ entries: [], nextCursor: null });
    const client = { get, post: vi.fn() } as unknown as PortalClient;
    render(<AuditPanel client={client} />);
    await waitFor(() =>
      expect(screen.getByText("No activity recorded yet.")).toBeTruthy(),
    );
  });
});
