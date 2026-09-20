// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { PaymentDetail } from "./PaymentDetail";
import type { PortalClient } from "./portal";

afterEach(cleanup);

const detail = {
  id: "pi_1",
  status: "succeeded",
  mode: "live",
  usdcSettlementRaw: "2000000",
  displayCurrency: "USD",
  displayAmountMinor: "200",
  pricingCurrency: "USD",
  fxRate: null,
  fxSource: null,
  fxQuotedAt: null,
  merchantReference: "order-9",
  metadata: { sku: "abc" },
  confirmationReference: "sig-123",
  failureReason: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-01-01T00:10:00.000Z",
  authorizedAt: "2026-01-01T00:05:00.000Z",
  settledAt: "2026-01-01T00:06:00.000Z",
  webhookDeliveries: [
    {
      id: "wd1",
      eventType: "payment.succeeded",
      status: "succeeded",
      attemptNo: 1,
      responseStatus: 200,
      createdAt: "2026-01-01T00:06:00.000Z",
    },
  ],
};

describe("PaymentDetail", () => {
  it("shows the confirmation reference, metadata and webhook delivery status", async () => {
    const get = vi.fn().mockResolvedValue(detail);
    const client = { get, post: vi.fn() } as unknown as PortalClient;
    render(<PaymentDetail client={client} paymentId="pi_1" />);
    await waitFor(() => expect(screen.getByText("sig-123")).toBeTruthy());
    expect(get).toHaveBeenCalledWith("payments/pi_1");
    expect(screen.getByText("payment.succeeded")).toBeTruthy();
    expect(screen.getByText("abc")).toBeTruthy();
  });

  it("surfaces a load error", async () => {
    const get = vi.fn().mockRejectedValue(new Error("Payment not found"));
    const client = { get, post: vi.fn() } as unknown as PortalClient;
    render(<PaymentDetail client={client} paymentId="pi_x" />);
    await waitFor(() =>
      expect(screen.getByText("Payment not found")).toBeTruthy(),
    );
  });
});
