import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { PortalClient } from "./portal";
import { formatUsdc, formatDisplayAmount } from "./money";
import { navigate, paymentPath } from "./router";
import { ErrorCard, Icon, PageHeader, SkeletonRows, StatusChip } from "./ui";
import { analytics } from "./analytics";

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

// The filters a merchant reaches for; "authorized" and "canceled" stay
// searchable but are too rare to earn a pill.
const FILTERS = ["succeeded", "created", "settling", "failed", "expired"];

export function statusLabel(status: string): string {
  if (status === "succeeded") return "Confirmed";
  if (status === "created") return "Not paid";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PaymentsPanel({
  client,
  onDevelopers,
}: {
  client: PortalClient;
  onDevelopers?: () => void;
}) {
  const [rows, setRows] = useState<PaymentSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "more">(
    "loading",
  );
  const [error, setError] = useState("");
  const [initialQuery] = useState(
    () => new URLSearchParams(window.location.search).get("q")?.trim() ?? "",
  );
  const [query, setQuery] = useState(initialQuery);
  const [applied, setApplied] = useState({ status: "", q: initialQuery });
  // Each request takes a generation; a filter change or a new load bumps it, so
  // a slower earlier response (e.g. a "Load more" for the previous filters that
  // resolves after the filter changed) is discarded instead of mixing rows.
  const generationRef = useRef(0);

  const load = useCallback(
    async (reset: boolean, filters: { status: string; q: string }) => {
      const generation = ++generationRef.current;
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
        if (generation !== generationRef.current) return;
        setRows((current) =>
          reset ? page.payments : [...current, ...page.payments],
        );
        setCursor(page.nextCursor);
        setStatus("ready");
      } catch (failure) {
        if (generation !== generationRef.current) return;
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

  function apply(next: { status: string; q: string }) {
    analytics.track("merchant_payments_filtered", {
      filter: (next.status || "all") + (next.q ? "+search" : ""),
    });
    setRows([]);
    setCursor(null);
    setApplied(next);
  }
  function search(event: FormEvent) {
    event.preventDefault();
    apply({ status: applied.status, q: query.trim() });
  }

  const filtered = applied.status !== "" || applied.q !== "";
  return (
    <section className="payments-workspace" aria-busy={status === "loading"}>
      <PageHeader
        title="Payments"
        description="Every Checkout attempt and its confirmed outcome."
      />

      <div className="toolbar">
        <div className="filter-pills" role="radiogroup" aria-label="Status">
          {["", ...FILTERS].map((value) => (
            <button
              key={value || "all"}
              type="button"
              role="radio"
              aria-checked={applied.status === value}
              onClick={() => apply({ status: value, q: query.trim() })}
            >
              {value ? statusLabel(value) : "All"}
            </button>
          ))}
        </div>
        <form className="search" role="search" onSubmit={search}>
          <Icon name="search" size={15} />
          <label className="visually-hidden" htmlFor="payments-search">
            Search
          </label>
          <input
            id="payments-search"
            type="search"
            value={query}
            placeholder="Search ID or reference"
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
      </div>

      {error ? (
        <ErrorCard
          title="Could not load Payments"
          message={error}
          onRetry={() => void load(true, applied)}
        />
      ) : status === "loading" ? (
        <div className="table-card">
          <div className="table-skeleton">
            <SkeletonRows rows={6} />
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="table-card">
          {filtered ? (
            <div className="empty">
              <div className="empty-icon">
                <Icon name="payments" />
              </div>
              <strong>No Payments match</strong>
              <p>Try another status or search term.</p>
            </div>
          ) : (
            <div className="empty">
              <div className="empty-icon">
                <Icon name="payments" />
              </div>
              <strong>No Payments yet</strong>
              <p>
                Every Checkout attempt appears here the moment your server
                creates it, simulations included.
              </p>
              {onDevelopers && (
                <div className="actions">
                  <button className="small" onClick={onDevelopers}>
                    Set up Checkout
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="table-card">
          <div
            className="table-wrap"
            role="region"
            aria-label="Payments"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="right">
                    USDC
                  </th>
                  <th scope="col">Payment</th>
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
                    <td className="amount-cell">
                      {formatDisplayAmount(
                        payment.displayCurrency,
                        payment.displayAmountMinor,
                      )}
                      <span>{payment.displayCurrency}</span>
                    </td>
                    <td>
                      <StatusChip status={payment.status}>
                        {statusLabel(payment.status)}
                      </StatusChip>
                    </td>
                    <td className="right muted-cell">
                      {formatUsdc(payment.usdcSettlementRaw, { suffix: true })}
                    </td>
                    <td className="id-cell">
                      <code>{payment.id}</code>
                      {payment.merchantReference && (
                        <span>{payment.merchantReference}</span>
                      )}
                    </td>
                    <td className="muted-cell">
                      {payment.mode === "test" ? "Simulation" : "On-chain"}
                    </td>
                    <td className="muted-cell">
                      {formatWhen(payment.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span>
              {rows.length} {rows.length === 1 ? "result" : "results"}
              {cursor ? " so far" : ""}
            </span>
            {cursor && (
              <button
                className="secondary small"
                disabled={status === "more"}
                onClick={() => void load(false, applied)}
              >
                {status === "more" ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
