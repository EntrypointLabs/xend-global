import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PortalClient } from "./portal";
import { formatWhen } from "./PaymentsPanel";
import { deliveryLabel } from "./PaymentDetail";
import { analytics, trackActionFailed } from "./analytics";
import {
  CodeTabs,
  ErrorCard,
  Icon,
  PageHeader,
  SkeletonRows,
  StatusChip,
} from "./ui";

export type WebhookEndpoint = {
  id: string;
  url: string;
  mode: "test" | "live";
  enabled: boolean;
  eventTypes: string[] | null;
  secondaryExpiresAt: string | null;
  createdAt: string;
};

type Delivery = {
  id: string;
  eventType: string;
  status: string;
  attemptNo: number;
  responseStatus: number | null;
  durationMs: number | null;
  nextRetryAt: string | null;
  createdAt: string;
};

// Delivery runs off the event bus, which production keeps off for now; the
// page must not imply endpoints receive events until it is switched on.
const DELIVERY_ENABLED =
  import.meta.env.VITE_WEBHOOK_DELIVERY_ENABLED === "true";

export function WebhooksPanel({
  client,
  onSecret,
  revealActive,
  cluster,
}: {
  client: PortalClient;
  /** Active Solana cluster; on devnet, execution webhooks are delivered in test
   * mode, so a live endpoint here would never be selected by the dispatcher. */
  cluster: string;
  /**
   * Surface a one-time signing secret to the workspace shell, which renders it
   * above the routed content so navigating away does not discard the only copy
   * the merchant is ever shown.
   */
  onSecret: (secret: string, label: string) => void;
  /** A one-time secret is currently on screen; block new secret-minting until
   * it is dismissed so a second create/rotate cannot overwrite it. */
  revealActive: boolean;
}) {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"test" | "live">("test");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  // A slow initial list load must not overwrite the refreshed list that a
  // create/rotate/delete produced; each load takes a generation and a stale
  // one is discarded.
  const loadGeneration = useRef(0);

  async function load() {
    const generation = ++loadGeneration.current;
    setStatus("loading");
    try {
      const data = await client.get<{ endpoints: WebhookEndpoint[] }>(
        "webhooks",
      );
      if (generation !== loadGeneration.current) return;
      setEndpoints(data.endpoints);
      setStatus("ready");
    } catch (failure) {
      if (generation !== loadGeneration.current) return;
      setError(failure instanceof Error ? failure.message : "Could not load.");
      setStatus("error");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const created = await client.post<WebhookEndpoint & { secret: string }>(
        "webhooks",
        { url, mode: cluster === "devnet" ? "test" : mode },
      );
      onSecret(created.secret, "Signing secret");
      analytics.track("merchant_webhook_saved", { is_new: true });
      setUrl("");
      await load();
    } catch (failure) {
      trackActionFailed("webhook_create", failure);
      setError(
        failure instanceof Error ? failure.message : "Could not create.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function rotate(id: string) {
    setBusy(true);
    setError("");
    try {
      const rotated = await client.post<{ secret: string }>(
        `webhooks/${encodeURIComponent(id)}/rotate_secret`,
      );
      onSecret(rotated.secret, "New signing secret");
      analytics.track("merchant_webhook_saved", { is_new: false });
      await load();
    } catch (failure) {
      trackActionFailed("webhook_rotate_secret", failure);
      setError(
        failure instanceof Error ? failure.message : "Could not rotate.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      await client.post(`webhooks/${encodeURIComponent(id)}/delete`);
      analytics.track("merchant_webhook_deleted", {});
      await load();
    } catch (failure) {
      trackActionFailed("webhook_delete", failure);
      setError(
        failure instanceof Error ? failure.message : "Could not delete.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="webhooks-workspace" aria-busy={busy}>
      <PageHeader
        eyebrow="Developers"
        title="Webhooks"
        description={
          <>
            Prydd posts a signed event to your endpoint for each Payment
            outcome, including <code>payment.succeeded</code>,{" "}
            <code>payment.failed</code> and <code>payment.expired</code>. Verify
            the signature and confirm the type is <code>payment.succeeded</code>{" "}
            before fulfilling an order; a failed or expired event is signed too,
            and a browser redirect alone is not proof of payment.
          </>
        }
      />

      {!DELIVERY_ENABLED && (
        <div className="notice" role="note">
          <Icon name="info" />
          <div>
            <strong>Event delivery is not switched on yet</strong>
            Endpoints you add are saved and start receiving signed events once
            delivery opens. Until then, confirm each Payment from your server
            with <code>GET /v1/payment_intents/:id</code>.
          </div>
        </div>
      )}

      {error && (
        <p className="banner-error" role="alert">
          {error}
        </p>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Add an endpoint</h2>
            <p>HTTPS only. Private and loopback addresses are rejected.</p>
          </div>
        </div>
        <form className="webhook-create" onSubmit={(e) => void create(e)}>
          <label>
            Endpoint URL
            <input
              type="url"
              required
              value={url}
              placeholder="https://your-store.com/webhooks/prydd"
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label>
            Mode
            {cluster === "devnet" ? (
              <input type="text" value="Test" readOnly />
            ) : (
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as "test" | "live")}
              >
                <option value="test">Test</option>
                <option value="live">Live</option>
              </select>
            )}
          </label>
          <button disabled={busy || revealActive}>
            <Icon name="plus" size={15} />
            Add endpoint
          </button>
        </form>
        {cluster === "devnet" && (
          <p className="footnote spaced">
            On devnet, execution webhooks are delivered to test endpoints.
          </p>
        )}
      </section>

      <section className="section">
        <div className="section-label">
          <h2>Endpoints</h2>
        </div>
        {status === "loading" && <SkeletonRows rows={2} />}
        {status === "error" && (
          <ErrorCard
            title="Could not load endpoints"
            message={error}
            onRetry={() => void load()}
          />
        )}
        {status === "ready" && endpoints && endpoints.length === 0 && (
          <div className="integrate">
            <div className="empty start">
              <div className="empty-icon">
                <Icon name="webhook" />
              </div>
              <strong>No endpoints yet</strong>
              <p>
                Add one to receive signed events. Your handler verifies the
                signature with the secret you get once, then acts only on{" "}
                <code>payment.succeeded</code>.
              </p>
            </div>
            <CodeTabs tabs={["verify"]} label="Webhook handler" />
          </div>
        )}
        {endpoints && endpoints.length > 0 && (
          <div className="endpoints">
            {endpoints.map((endpoint) => (
              <WebhookCard
                key={endpoint.id}
                endpoint={endpoint}
                client={client}
                busy={busy || revealActive}
                onRotate={() => void rotate(endpoint.id)}
                onDelete={() => void remove(endpoint.id)}
              />
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function WebhookCard({
  endpoint,
  client,
  busy,
  onRotate,
  onDelete,
}: {
  endpoint: WebhookEndpoint;
  client: PortalClient;
  busy: boolean;
  onRotate: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);
  const [deliveryError, setDeliveryError] = useState("");

  async function loadDeliveries(reset: boolean) {
    setLoadingDeliveries(true);
    setDeliveryError("");
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (!reset && cursor) params.set("cursor", cursor);
      const data = await client.get<{
        deliveries: Delivery[];
        nextCursor: string | null;
      }>(
        `webhooks/${encodeURIComponent(endpoint.id)}/deliveries?${params.toString()}`,
      );
      setDeliveries((current) =>
        reset || !current ? data.deliveries : [...current, ...data.deliveries],
      );
      setCursor(data.nextCursor);
    } catch (failure) {
      setDeliveryError(
        failure instanceof Error
          ? failure.message
          : "Could not load deliveries.",
      );
    } finally {
      setLoadingDeliveries(false);
    }
  }

  return (
    <article className="endpoint">
      <div className="endpoint-head">
        <div>
          <h3 className="endpoint-url">{endpoint.url}</h3>
          <p className="endpoint-meta">
            Added {formatWhen(endpoint.createdAt)}
            {endpoint.eventTypes
              ? ` · ${endpoint.eventTypes.join(", ")}`
              : " · all event types"}
            {endpoint.secondaryExpiresAt
              ? ` · previous secret valid until ${formatWhen(endpoint.secondaryExpiresAt)}`
              : ""}
          </p>
        </div>
        <span className="chip plain">
          {endpoint.mode === "live" ? "Live" : "Test"}
        </span>
      </div>
      <div className="actions">
        <button className="secondary small" disabled={busy} onClick={onRotate}>
          Rotate secret
        </button>
        <button
          className="secondary small"
          disabled={loadingDeliveries}
          onClick={() => void loadDeliveries(true)}
        >
          {loadingDeliveries ? "Loading…" : "Recent deliveries"}
        </button>
        {confirming ? (
          <>
            <button className="danger small" disabled={busy} onClick={onDelete}>
              Confirm delete
            </button>
            <button
              className="quiet small"
              onClick={() => setConfirming(false)}
            >
              Keep
            </button>
          </>
        ) : (
          <button className="quiet small" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
      </div>
      {deliveryError && (
        <p className="inline-error" role="alert">
          {deliveryError}
        </p>
      )}
      {deliveries && (
        <div className="deliveries">
          {deliveries.length === 0 ? (
            <p>No deliveries yet.</p>
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
                  {deliveries.map((delivery) => (
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
                        {formatWhen(delivery.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {cursor && (
            <div className="table-foot">
              <button
                className="secondary small"
                disabled={loadingDeliveries}
                onClick={() => void loadDeliveries(false)}
              >
                {loadingDeliveries ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
