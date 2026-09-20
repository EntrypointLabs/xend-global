import { useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import "./workspace.css";
import type { PortalClient } from "./portal";
import { WebhooksPanel } from "./WebhooksPanel";
import { PaymentsPanel } from "./PaymentsPanel";
import { PaymentDetail } from "./PaymentDetail";
import { AuditPanel } from "./AuditPanel";

/**
 * A dev-only harness for eyeballing the portal panels without Privy sign-in or
 * a running backend. Not part of the shipped app: main.tsx never imports it.
 */
const stub: PortalClient = {
  get: async <T,>(path: string): Promise<T> => {
    if (path.startsWith("webhooks/") && path.includes("/deliveries"))
      return {
        deliveries: [
          {
            id: "wd1",
            eventType: "payment.succeeded",
            status: "succeeded",
            attemptNo: 1,
            responseStatus: 200,
            durationMs: 142,
            nextRetryAt: null,
            createdAt: new Date().toISOString(),
          },
        ],
      } as T;
    if (path.startsWith("webhooks"))
      return {
        endpoints: [
          {
            id: "wh1",
            url: "https://acme.example.com/webhooks/xend",
            mode: "live",
            enabled: true,
            eventTypes: null,
            secondaryExpiresAt: null,
            createdAt: new Date().toISOString(),
          },
        ],
      } as T;
    if (path.startsWith("payments/"))
      return {
        id: "pi_demo",
        status: "succeeded",
        mode: "live",
        usdcSettlementRaw: "42170000",
        displayCurrency: "USD",
        displayAmountMinor: "4217",
        pricingCurrency: "USD",
        fxRate: null,
        fxSource: null,
        fxQuotedAt: null,
        merchantReference: "order-1042",
        metadata: { sku: "TSHIRT-L", channel: "web" },
        confirmationReference: "5Hh9...devnetsig",
        failureReason: null,
        createdAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
        authorizedAt: new Date().toISOString(),
        settledAt: new Date().toISOString(),
        webhookDeliveries: [
          {
            id: "wd1",
            eventType: "payment.succeeded",
            status: "succeeded",
            attemptNo: 1,
            responseStatus: 200,
            createdAt: new Date().toISOString(),
          },
        ],
      } as T;
    if (path.startsWith("payments"))
      return {
        payments: Array.from({ length: 6 }, (_, i) => ({
          id: `pi_${1000 + i}`,
          status: ["succeeded", "created", "failed", "expired"][i % 4],
          usdcSettlementRaw: String((i + 1) * 5_000000),
          displayCurrency: "USD",
          displayAmountMinor: String((i + 1) * 500),
          merchantReference: i % 2 ? `order-${i}` : null,
          mode: i % 3 ? "live" : "test",
          createdAt: new Date(Date.now() - i * 86400000).toISOString(),
        })),
        nextCursor: "pi_1005",
      } as T;
    if (path.startsWith("audit"))
      return {
        entries: [
          {
            id: "a1",
            action: "api_key.issue",
            target: "ak_1",
            metadata: { mode: "live" },
            at: new Date().toISOString(),
          },
          {
            id: "a2",
            action: "webhook.rotate_secret",
            target: "wh1",
            metadata: null,
            at: new Date(Date.now() - 3600000).toISOString(),
          },
          {
            id: "a3",
            action: "profile.update",
            target: "m1",
            metadata: { version: "3" },
            at: new Date(Date.now() - 7200000).toISOString(),
          },
        ],
        nextCursor: null,
      } as T;
    return {} as T;
  },
  post: async <T,>(): Promise<T> => ({}) as T,
};

const PANELS = ["payments", "payment", "webhooks", "audit"] as const;

function Review() {
  const [panel, setPanel] = useState<(typeof PANELS)[number]>("payments");
  return (
    <div className="shell workspace" data-page={panel}>
      <aside>
        <span className="wordmark">
          <span className="version-pill">v1</span>xend review
        </span>
        <nav aria-label="Review">
          {PANELS.map((name) => (
            <button
              key={name}
              className={panel === name ? "selected" : ""}
              onClick={() => setPanel(name)}
            >
              {name}
            </button>
          ))}
        </nav>
      </aside>
      <main>
        {panel === "payments" && <PaymentsPanel client={stub} />}
        {panel === "payment" && (
          <PaymentDetail client={stub} paymentId="pi_demo" />
        )}
        {panel === "webhooks" && (
          <WebhooksPanel
            client={stub}
            onSecret={() => {}}
            revealActive={false}
            cluster="devnet"
          />
        )}
        {panel === "audit" && <AuditPanel client={stub} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("review")!).render(<Review />);
