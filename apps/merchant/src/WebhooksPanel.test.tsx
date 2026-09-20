// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { WebhooksPanel } from "./WebhooksPanel";
import type { PortalClient } from "./portal";

afterEach(cleanup);

function endpoint(over: Record<string, unknown> = {}) {
  return {
    id: "wh1",
    url: "https://example.com/hook",
    mode: "test",
    enabled: true,
    eventTypes: null,
    secondaryExpiresAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("WebhooksPanel", () => {
  it("lists endpoints without ever showing a stored secret", async () => {
    const get = vi.fn().mockResolvedValue({ endpoints: [endpoint()] });
    const client = { get, post: vi.fn() } as unknown as PortalClient;
    render(<WebhooksPanel client={client} />);
    await waitFor(() =>
      expect(screen.getByText("https://example.com/hook")).toBeTruthy(),
    );
    expect(screen.queryByText(/whsec_/)).toBeNull();
  });

  it("creates an endpoint and reveals the signing secret once", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ endpoints: [] })
      .mockResolvedValueOnce({ endpoints: [endpoint()] });
    const post = vi
      .fn()
      .mockResolvedValue({ ...endpoint(), secret: "whsec_new_secret" });
    const client = { get, post } as unknown as PortalClient;
    render(<WebhooksPanel client={client} />);
    await waitFor(() => expect(get).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/Endpoint URL/), {
      target: { value: "https://example.com/hook" },
    });
    fireEvent.click(screen.getByText("Add endpoint"));

    await waitFor(() =>
      expect(screen.getByText("whsec_new_secret")).toBeTruthy(),
    );
    expect(post.mock.calls[0]?.[0]).toBe("webhooks");
  });
});
