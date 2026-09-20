import { useCallback, useEffect, useState } from "react";
import type { PortalClient } from "./portal";

type AuditEntry = {
  id: string;
  action: string;
  target: string | null;
  metadata: Record<string, string> | null;
  at: string;
};

const ACTION_LABELS: Record<string, string> = {
  "profile.update": "Business details updated",
  "destination.provision": "Receiving account initialized",
  "api_key.issue": "API key created",
  "api_key.revoke": "API key revoked",
  "api_key.rotate": "API key rotated",
  "webhook.create": "Webhook endpoint added",
  "webhook.rotate_secret": "Webhook secret rotated",
  "webhook.delete": "Webhook endpoint removed",
  "kyb.submit": "Verification submitted",
};

const METADATA_LABELS: Record<string, string> = {
  url: "URL",
  mode: "Mode",
  fingerprint: "Key",
  rotatedFrom: "Replaced key",
};

function label(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function describe(entry: AuditEntry): string {
  const parts: string[] = [];
  if (entry.metadata)
    for (const [key, value] of Object.entries(entry.metadata))
      parts.push(`${METADATA_LABELS[key] ?? key}: ${value}`);
  // Fall back to the raw target so every row still names the object it touched
  // when an older entry predates the enriched metadata.
  if (parts.length === 0 && entry.target) parts.push(entry.target);
  return parts.join(" · ");
}

export function AuditPanel({ client }: { client: PortalClient }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "more">(
    "loading",
  );
  const [error, setError] = useState("");

  const load = useCallback(
    async (reset: boolean, from: string | null) => {
      setStatus(reset ? "loading" : "more");
      setError("");
      try {
        const params = new URLSearchParams({ limit: "25" });
        if (from) params.set("cursor", from);
        const page = await client.get<{
          entries: AuditEntry[];
          nextCursor: string | null;
        }>(`audit?${params.toString()}`);
        setEntries((current) =>
          reset ? page.entries : [...current, ...page.entries],
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
    [client],
  );

  useEffect(() => {
    void load(true, null);
  }, [load]);

  return (
    <section className="panel audit-workspace" aria-busy={status === "loading"}>
      <div className="workspace-page-title">
        <h1>Activity log</h1>
        <p>
          A record of sensitive changes to your account: business details, API
          keys, webhook endpoints and verification.
        </p>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {status !== "loading" && entries.length === 0 && !error ? (
        <p>No activity recorded yet.</p>
      ) : (
        <ol className="audit-list">
          {entries.map((entry) => (
            <li key={entry.id} className="audit-entry">
              <div className="audit-entry-main">
                <strong>{label(entry.action)}</strong>
                <time dateTime={entry.at}>
                  {new Date(entry.at).toLocaleString()}
                </time>
              </div>
              {describe(entry) && (
                <span className="audit-entry-detail">{describe(entry)}</span>
              )}
            </li>
          ))}
        </ol>
      )}

      {cursor && (
        <div className="actions">
          <button
            className="secondary"
            disabled={status === "more"}
            onClick={() => void load(false, cursor)}
          >
            {status === "more" ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </section>
  );
}
