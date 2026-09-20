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
          actor: "Owner",
          target: "k1",
          metadata: { mode: "test" },
          at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "a2",
          action: "webhook.create",
          actor: "API key",
          target: "wh1",
          metadata: { url: "https://example.com/hook" },
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
    expect(screen.getByText("Webhook endpoint added")).toBeTruthy();
    // The owner-made change and the integration-key change are distinguishable.
    expect(screen.getByText(/By Owner · Mode: test/)).toBeTruthy();
    expect(
      screen.getByText(/By API key · URL: https:\/\/example.com\/hook/),
    ).toBeTruthy();
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
