// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PaymentsPanel } from "./PaymentsPanel";
import type { PortalClient } from "./portal";

afterEach(cleanup);

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    status: "succeeded",
    usdcSettlementRaw: "1000000",
    displayCurrency: "USD",
    displayAmountMinor: "100",
    merchantReference: null,
    mode: "test",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("PaymentsPanel", () => {
  it("loads and renders the first page, then appends on load more", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ payments: [row("pi_1")], nextCursor: "pi_1" })
      .mockResolvedValueOnce({ payments: [row("pi_2")], nextCursor: null });
    const client = { get, post: vi.fn() } as unknown as PortalClient;
    render(<PaymentsPanel client={client} />);

    await waitFor(() => expect(screen.getByText("pi_1")).toBeTruthy());
    expect(String(get.mock.calls[0]?.[0])).toContain("payments?");

    fireEvent.click(screen.getByText("Load more"));
    await waitFor(() => expect(screen.getByText("pi_2")).toBeTruthy());
    expect(String(get.mock.calls[1]?.[0])).toContain("cursor=pi_1");
  });

  it("applies a status filter and search to the query", async () => {
    const get = vi.fn().mockResolvedValue({ payments: [], nextCursor: null });
    const client = { get, post: vi.fn() } as unknown as PortalClient;
    render(<PaymentsPanel client={client} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "succeeded" },
    });
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "order-9" },
    });
    fireEvent.click(screen.getByText("Apply"));

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    const query = String(get.mock.calls[1]?.[0]);
    expect(query).toContain("status=succeeded");
    expect(query).toContain("q=order-9");
  });
});
