import { useEffect, useState } from "react";
import type { PortalClient } from "./portal";
import { formatUsdc, formatDisplayAmount } from "./money";
import { navigate, pagePath } from "./router";
import { statusLabel } from "./PaymentsPanel";

type WebhookDelivery = {
  id: string;
  eventType: string;
  status: string;
  attemptNo: number;
  responseStatus: number | null;
  createdAt: string;
};

type PaymentDetailView = {
  id: string;
  status: string;
  mode: string;
  usdcSettlementRaw: string;
  displayCurrency: string;
  displayAmountMinor: string;
  pricingCurrency: string | null;
  fxRate: string | null;
  fxSource: string | null;
  fxQuotedAt: string | null;
  merchantReference: string | null;
  metadata: Record<string, string> | null;
  confirmationReference: string | null;
  failureReason: string | null;
  createdAt: string;
  expiresAt: string;
  authorizedAt: string | null;
  settledAt: string | null;
  webhookDeliveries: WebhookDelivery[];
};

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

export function PaymentDetail({
  client,
  paymentId,
}: {
  client: PortalClient;
  paymentId: string;
}) {
  const [payment, setPayment] = useState<PaymentDetailView | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setStatus("loading");
    client
      .get<PaymentDetailView>(`payments/${encodeURIComponent(paymentId)}`)
      .then((data) => {
        if (!active) return;
        setPayment(data);
        setStatus("ready");
      })
      .catch((failure: unknown) => {
        if (!active) return;
        setError(
          failure instanceof Error ? failure.message : "Could not load.",
        );
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [client, paymentId]);

  return (
    <section className="panel payment-detail" aria-busy={status === "loading"}>
      <button
        className="quiet back-link"
        onClick={() => navigate(pagePath("payments"))}
      >
        ← All Payments
      </button>
      {status === "loading" && <p role="status">Loading Payment…</p>}
      {status === "error" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {payment && (
        <>
          <div className="workspace-page-title">
            <h1>
              {formatDisplayAmount(
                payment.displayCurrency,
                payment.displayAmountMinor,
              )}
            </h1>
            <p>
              <span className="payment-status" data-status={payment.status}>
                {statusLabel(payment.status)}
              </span>{" "}
              · <code>{payment.id}</code>
            </p>
          </div>

          <dl className="detail-grid">
            <div>
              <dt>USDC settlement</dt>
              <dd>{formatUsdc(payment.usdcSettlementRaw, { suffix: true })}</dd>
            </div>
            <div>
              <dt>Priced in</dt>
              <dd>
                {formatDisplayAmount(
                  payment.displayCurrency,
                  payment.displayAmountMinor,
                )}
                {payment.pricingCurrency ? ` (${payment.pricingCurrency})` : ""}
              </dd>
            </div>
            {payment.fxRate && (
              <div>
                <dt>Exchange rate</dt>
                <dd>
                  {payment.fxRate}
                  {payment.fxSource ? ` · ${payment.fxSource}` : ""}
                  {payment.fxQuotedAt ? ` · ${when(payment.fxQuotedAt)}` : ""}
                </dd>
              </div>
            )}
            <div>
              <dt>Mode</dt>
              <dd>
                {payment.mode === "test" ? "Simulation" : "On-chain execution"}
              </dd>
            </div>
            <div>
              <dt>Merchant reference</dt>
              <dd>{payment.merchantReference ?? "—"}</dd>
            </div>
            <div>
              <dt>Confirmation reference</dt>
              <dd>
                {payment.confirmationReference ? (
                  <code>{payment.confirmationReference}</code>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            {payment.failureReason && (
              <div>
                <dt>Failure reason</dt>
                <dd>{payment.failureReason}</dd>
              </div>
            )}
            <div>
              <dt>Created</dt>
              <dd>{when(payment.createdAt)}</dd>
            </div>
            <div>
              <dt>Quote expires</dt>
              <dd>{when(payment.expiresAt)}</dd>
            </div>
            <div>
              <dt>Authorized</dt>
              <dd>{when(payment.authorizedAt)}</dd>
            </div>
            <div>
              <dt>Settled</dt>
              <dd>{when(payment.settledAt)}</dd>
            </div>
          </dl>

          {payment.metadata && Object.keys(payment.metadata).length > 0 && (
            <section className="detail-section">
              <h2>Metadata</h2>
              <dl className="detail-grid">
                {Object.entries(payment.metadata).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section className="detail-section">
            <h2>Webhook delivery</h2>
            {payment.webhookDeliveries.length === 0 ? (
              <p>
                No webhook deliveries recorded. A webhook fires only when a
                Payment is confirmed on-chain.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">Status</th>
                    <th scope="col">Attempt</th>
                    <th scope="col">HTTP</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {payment.webhookDeliveries.map((delivery) => (
                    <tr key={delivery.id}>
                      <td>{delivery.eventType}</td>
                      <td>
                        <span
                          className="payment-status"
                          data-status={delivery.status}
                        >
                          {delivery.status}
                        </span>
                      </td>
                      <td>{delivery.attemptNo}</td>
                      <td>{delivery.responseStatus ?? "—"}</td>
                      <td>{when(delivery.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </section>
  );
}
