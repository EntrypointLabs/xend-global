import { useCallback, useEffect, useState } from "react";
import type { PortalClient } from "./portal";
import { formatWhen } from "./PaymentsPanel";
import { ErrorCard, Icon, PageHeader, SkeletonRows } from "./ui";

type AuditEntry = {
  id: string;
  action: string;
  actor: string;
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

function iconFor(action: string) {
  if (action.startsWith("api_key")) return "key" as const;
  if (action.startsWith("webhook")) return "webhook" as const;
  if (action.startsWith("kyb")) return "shield" as const;
  return "account" as const;
}

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
    <section className="audit-workspace" aria-busy={status === "loading"}>
      <PageHeader
        title="Activity"
        description="A record of sensitive changes to your account: business details, API keys, webhook endpoints and verification."
      />

      {error && (
        <ErrorCard
          title="Could not load activity"
          message={error}
          onRetry={() => void load(true, null)}
        />
      )}

      {!(error && entries.length === 0) && (
        <div>
          {status === "loading" ? (
            <SkeletonRows rows={5} />
          ) : entries.length === 0 && !error ? (
            <div className="empty">
              <div className="empty-icon">
                <Icon name="activity" />
              </div>
              <p>No activity recorded yet.</p>
            </div>
          ) : (
            <ol className="audit-list">
              {entries.map((entry) => (
                <li key={entry.id} className="audit-entry">
                  <span className="audit-dot" aria-hidden="true">
                    <Icon name={iconFor(entry.action)} size={15} />
                  </span>
                  <div>
                    <strong>{label(entry.action)}</strong>
                    <span className="audit-entry-detail">
                      {`By ${entry.actor}`}
                      {describe(entry) ? ` · ${describe(entry)}` : ""}
                    </span>
                  </div>
                  <time dateTime={entry.at}>{formatWhen(entry.at)}</time>
                </li>
              ))}
            </ol>
          )}
          {cursor && (
            <div className="card-foot">
              <button
                className="secondary small"
                disabled={status === "more"}
                onClick={() => void load(false, cursor)}
              >
                {status === "more" ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
