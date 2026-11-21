import { useEffect, useState } from "react";
import type { PortalClient } from "./portal";
import { formatUsdc, formatDisplayAmount } from "./money";
import { navigate, pagePath } from "./router";
import { formatWhen, statusLabel } from "./PaymentsPanel";
import { CopyButton, ErrorCard, Icon, LoadingBlock, StatusChip } from "./ui";

export function deliveryLabel(status: string): string {
  if (status === "succeeded") return "Delivered";
  if (status === "failed") return "Failed";
  if (status === "pending") return "Retrying";
  if (status === "exhausted") return "Stopped retrying";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

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
  return iso ? formatWhen(iso) : "Not yet";
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

  const steps = payment
    ? [
        { label: "Created", at: payment.createdAt },
        { label: "Authorized", at: payment.authorizedAt },
        {
          label:
            payment.status === "failed"
              ? "Failed"
              : payment.status === "expired"
                ? "Expired"
                : payment.status === "canceled"
                  ? "Canceled"
                  : "Settled",
          at:
            payment.settledAt ??
            (["failed", "expired", "canceled"].includes(payment.status)
              ? payment.expiresAt
              : null),
        },
      ]
    : [];

  const lastUpdate = payment
    ? (payment.settledAt ?? payment.authorizedAt ?? payment.createdAt)
    : null;

  return (
    <section className="payment-detail" aria-busy={status === "loading"}>
      <button
        className="quiet small back-link"
        onClick={() => navigate(pagePath("payments"))}
      >
        <Icon name="back" size={15} />
        Payments
      </button>
      {status === "loading" && <LoadingBlock label="Loading Payment…" />}
      {status === "error" && (
        <ErrorCard title="Could not load this Payment" message={error} />
      )}
      {payment && (
        <>
          <div className="detail-hero">
            <p className="page-eyebrow">Payment</p>
            <div className="detail-hero-top">
              <h1>
                {formatDisplayAmount(
                  payment.displayCurrency,
                  payment.displayAmountMinor,
                )}
                <span>{payment.displayCurrency}</span>
              </h1>
              <StatusChip status={payment.status}>
                {statusLabel(payment.status)}
              </StatusChip>
            </div>
            <div className="fact-row">
              <div>
                <span>Last update</span>
                <strong>{when(lastUpdate)}</strong>
              </div>
              <div>
                <span>Settles as</span>
                <strong>
                  {formatUsdc(payment.usdcSettlementRaw, { suffix: true })}
                </strong>
              </div>
              <div>
                <span>Mode</span>
                <strong>
                  {payment.mode === "test"
                    ? "Simulation"
                    : "On-chain execution"}
                </strong>
              </div>
              <div>
                <span>Your reference</span>
                <strong>{payment.merchantReference ?? "None"}</strong>
              </div>
            </div>
          </div>

          <div className="detail-layout">
            <div className="detail-main">
              <section className="detail-block">
                <h2>Timeline</h2>
                <ol className="timeline">
                  {steps.map((step) => (
                    <li key={step.label} data-done={step.at !== null}>
                      <i aria-hidden="true">
                        <Icon
                          name={step.at !== null ? "check" : "clock"}
                          size={13}
                        />
                      </i>
                      <div>
                        <strong>{step.label}</strong>
                        <span>{step.at ? when(step.at) : "Not yet"}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="detail-block">
                <h2>Payment details</h2>
                <dl className="kv">
                  <div>
                    <dt>USDC settlement</dt>
                    <dd>
                      {formatUsdc(payment.usdcSettlementRaw, { suffix: true })}
                    </dd>
                  </div>
                  <div>
                    <dt>Priced in</dt>
                    <dd>
                      {formatDisplayAmount(
                        payment.displayCurrency,
                        payment.displayAmountMinor,
                      )}
                      {payment.pricingCurrency
                        ? ` (${payment.pricingCurrency})`
                        : ""}
                    </dd>
                  </div>
                  {payment.fxRate && (
                    <div>
                      <dt>Exchange rate</dt>
                      <dd>
                        {payment.fxRate}
                        {payment.fxSource ? ` · ${payment.fxSource}` : ""}
                        {payment.fxQuotedAt
                          ? ` · ${when(payment.fxQuotedAt)}`
                          : ""}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Confirmation</dt>
                    <dd>
                      {payment.confirmationReference ? (
                        <code>{payment.confirmationReference}</code>
                      ) : (
                        "Not confirmed"
                      )}
                    </dd>
                  </div>
                  {payment.failureReason && (
                    <div>
                      <dt>Failure reason</dt>
                      <dd>{payment.failureReason}</dd>
                    </div>
                  )}
                </dl>
              </section>

              <section className="detail-block">
                <h2>Webhook delivery</h2>
                {payment.webhookDeliveries.length === 0 ? (
                  <p className="card-sub section-tight">
                    No webhook deliveries recorded for this Payment. Signed
                    events such as <code>payment.succeeded</code>,{" "}
                    <code>payment.failed</code> and <code>payment.expired</code>{" "}
                    go to the endpoints configured for this mode once delivery
                    is on.
                  </p>
                ) : (
                  <div className="table-wrap">
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
                            <td>
                              <code>{delivery.eventType}</code>
                            </td>
                            <td>
                              <StatusChip status={delivery.status}>
                                {deliveryLabel(delivery.status)}
                              </StatusChip>
                            </td>
                            <td className="muted-cell">{delivery.attemptNo}</td>
                            <td className="muted-cell">
                              {delivery.responseStatus ?? "None"}
                            </td>
                            <td className="muted-cell">
                              {when(delivery.createdAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            <aside className="detail-side">
              <section className="detail-block">
                <h2>Details</h2>
                <dl className="kv">
                  <div>
                    <dt>Payment ID</dt>
                    <dd>
                      <span className="copy-field">
                        <code>{payment.id}</code>
                        <CopyButton
                          value={payment.id}
                          label="Copy Payment ID"
                        />
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>{when(payment.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Quote expires</dt>
                    <dd>{when(payment.expiresAt)}</dd>
                  </div>
                </dl>
              </section>

              <section className="detail-block">
                <h2>Metadata</h2>
                {payment.metadata &&
                Object.keys(payment.metadata).length > 0 ? (
                  <dl className="kv">
                    {Object.entries(payment.metadata).map(([key, value]) => (
                      <div key={key}>
                        <dt>
                          <code>{key}</code>
                        </dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="card-sub section-tight">No metadata.</p>
                )}
              </section>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
