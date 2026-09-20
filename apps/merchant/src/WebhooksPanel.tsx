import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PortalClient } from "./portal";
import { KeyReveal } from "./KeyReveal";

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

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function WebhooksPanel({ client }: { client: PortalClient }) {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"test" | "live">("test");
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState("");
  const [secretLabel, setSecretLabel] = useState("");
  const submitting = useRef(false);

  async function load() {
    setStatus("loading");
    try {
      const data = await client.get<{ endpoints: WebhookEndpoint[] }>(
        "webhooks",
      );
      setEndpoints(data.endpoints);
      setStatus("ready");
    } catch (failure) {
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
        { url, mode },
      );
      setSecret(created.secret);
      setSecretLabel("Signing secret");
      setUrl("");
      await load();
    } catch (failure) {
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
      setSecret(rotated.secret);
      setSecretLabel("New signing secret");
      await load();
    } catch (failure) {
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
      await load();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not delete.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel webhooks-workspace" aria-busy={busy}>
      <div className="workspace-page-title">
        <h1>Webhooks</h1>
        <p>
          Xend posts a signed event to your endpoint when a Payment is
          confirmed. Verify the signature before fulfilling an order; a browser
          redirect alone is not proof of payment.
        </p>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {secret && (
        <KeyReveal
          key={secret}
          secret={secret}
          label={secretLabel}
          onDismiss={() => setSecret("")}
        />
      )}

      <form className="webhook-create" onSubmit={(e) => void create(e)}>
        <div className="section-head">
          <h2>Add an endpoint</h2>
        </div>
        <div className="webhook-create-fields">
          <label>
            Endpoint URL
            <input
              type="url"
              required
              value={url}
              placeholder="https://your-store.com/webhooks/xend"
              onChange={(e) => setUrl(e.target.value)}
            />
            <small>
              HTTPS only. Private and loopback addresses are rejected.
            </small>
          </label>
          <label>
            Mode
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "test" | "live")}
            >
              <option value="test">Test</option>
              <option value="live">Live</option>
            </select>
          </label>
        </div>
        <div className="actions">
          <button disabled={busy}>Add endpoint</button>
        </div>
      </form>

      {status === "loading" && <p role="status">Loading endpoints…</p>}
      {status === "error" && (
        <button className="secondary" onClick={() => void load()}>
          Try again
        </button>
      )}
      {status === "ready" && endpoints && endpoints.length === 0 && (
        <p>No endpoints yet. Add one to start receiving signed events.</p>
      )}

      <div className="key-cards">
        {endpoints?.map((endpoint) => (
          <WebhookCard
            key={endpoint.id}
            endpoint={endpoint}
            client={client}
            busy={busy}
            onRotate={() => void rotate(endpoint.id)}
            onDelete={() => void remove(endpoint.id)}
          />
        ))}
      </div>
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

  async function loadDeliveries(reset: boolean) {
    setLoadingDeliveries(true);
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
    } finally {
      setLoadingDeliveries(false);
    }
  }

  return (
    <article className="key-card webhook-card">
      <div className="section-head">
        <h3 className="webhook-url">{endpoint.url}</h3>
        <span className="badge">
          {endpoint.mode === "live" ? "Live" : "Test"}
        </span>
      </div>
      <small>
        Added {formatWhen(endpoint.createdAt)}
        {endpoint.eventTypes
          ? ` · ${endpoint.eventTypes.join(", ")}`
          : " · all event types"}
        {endpoint.secondaryExpiresAt
          ? ` · previous secret valid until ${formatWhen(endpoint.secondaryExpiresAt)}`
          : ""}
      </small>
      <div className="webhook-actions actions">
        <button className="secondary" disabled={busy} onClick={onRotate}>
          Rotate secret
        </button>
        <button
          className="secondary"
          disabled={loadingDeliveries}
          onClick={() => void loadDeliveries(true)}
        >
          {loadingDeliveries ? "Loading…" : "Recent deliveries"}
        </button>
        {confirming ? (
          <>
            <button className="secondary" disabled={busy} onClick={onDelete}>
              Confirm delete
            </button>
            <button className="secondary" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="secondary" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
      </div>
      {deliveries && (
        <div className="webhook-deliveries">
          {deliveries.length === 0 ? (
            <p>No deliveries yet.</p>
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
                {deliveries.map((delivery) => (
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
                    <td>{formatWhen(delivery.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {cursor && (
            <button
              className="secondary"
              disabled={loadingDeliveries}
              onClick={() => void loadDeliveries(false)}
            >
              {loadingDeliveries ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
