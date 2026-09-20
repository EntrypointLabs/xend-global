import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { PortalClient } from "./portal";
import { formatUsdc, formatDisplayAmount } from "./money";
import { navigate, paymentPath } from "./router";

export type PaymentSummary = {
  id: string;
  status: string;
  usdcSettlementRaw: string;
  displayCurrency: string;
  displayAmountMinor: string;
  merchantReference: string | null;
  mode: string;
  createdAt: string;
};

const STATUSES = [
  "created",
  "authorized",
  "settling",
  "succeeded",
  "failed",
  "expired",
  "canceled",
] as const;

export function statusLabel(status: string): string {
  if (status === "succeeded") return "Confirmed";
  if (status === "created") return "Not paid";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function PaymentsPanel({ client }: { client: PortalClient }) {
  const [rows, setRows] = useState<PaymentSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "more">(
    "loading",
  );
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState({ status: "", q: "" });

  const load = useCallback(
    async (reset: boolean, filters: { status: string; q: string }) => {
      setStatus(reset ? "loading" : "more");
      setError("");
      try {
        const params = new URLSearchParams({ limit: "20" });
        if (filters.status) params.set("status", filters.status);
        if (filters.q) params.set("q", filters.q);
        if (!reset && cursor) params.set("cursor", cursor);
        const page = await client.get<{
          payments: PaymentSummary[];
          nextCursor: string | null;
        }>(`payments?${params.toString()}`);
        setRows((current) =>
          reset ? page.payments : [...current, ...page.payments],
        );
        setCursor(page.nextCursor);
        setStatus("ready");
      } catch (failure) {
        setError(
          failure instanceof Error ? failure.message : "Could not load.",
        );
        setStatus("error");
      }
    },
    [client, cursor],
  );

  useEffect(() => {
    void load(true, applied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  function apply(event: FormEvent) {
    event.preventDefault();
    setRows([]);
    setCursor(null);
    setApplied({ status: statusFilter, q: query.trim() });
  }

  return (
    <section
      className="panel payments-workspace"
      aria-busy={status === "loading"}
    >
      <div className="section-head">
        <div className="workspace-page-title">
          <h1>Payments</h1>
          <p>Every Checkout attempt and its confirmed outcome</p>
        </div>
      </div>

      <form className="payments-filters" onSubmit={apply}>
        <label>
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {statusLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search
          <input
            type="search"
            value={query}
            placeholder="Reference or order id"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button className="secondary">Apply</button>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {status !== "loading" && rows.length === 0 && !error ? (
        <p>No Payments match. Your Checkout attempts appear here.</p>
      ) : (
        <div
          className="table-wrap"
          role="region"
          aria-label="Payments"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Amount</th>
                <th scope="col">USDC</th>
                <th scope="col">Status</th>
                <th scope="col">Mode</th>
                <th scope="col">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((payment) => (
                <tr
                  key={payment.id}
                  className="payment-row"
                  tabIndex={0}
                  role="link"
                  onClick={() => navigate(paymentPath(payment.id))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(paymentPath(payment.id));
                    }
                  }}
                >
                  <td>
                    <code>{payment.id}</code>
                    {payment.merchantReference && (
                      <span className="payment-ref">
                        {payment.merchantReference}
                      </span>
                    )}
                  </td>
                  <td>
                    {formatDisplayAmount(
                      payment.displayCurrency,
                      payment.displayAmountMinor,
                    )}
                  </td>
                  <td>
                    {formatUsdc(payment.usdcSettlementRaw, { suffix: true })}
                  </td>
                  <td>
                    <span
                      className="payment-status"
                      data-status={payment.status}
                    >
                      {statusLabel(payment.status)}
                    </span>
                  </td>
                  <td>{payment.mode === "test" ? "Simulation" : "On-chain"}</td>
                  <td>{formatWhen(payment.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cursor && (
        <div className="actions">
          <button
            className="secondary"
            disabled={status === "more"}
            onClick={() => void load(false, applied)}
          >
            {status === "more" ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </section>
  );
}
