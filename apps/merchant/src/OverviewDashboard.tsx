import { formatUsdc as money } from "./money";
type Payment = { id: string; status: string; amountRaw: string; mode: string };

export function OverviewDashboard({
  payments,
  activeKeys,
  cluster,
  name,
  onPayments,
  onAccount,
}: {
  payments: Payment[];
  activeKeys: number;
  cluster: string;
  name: string;
  onPayments: () => void;
  onAccount: () => void;
}) {
  const confirmed = payments.filter(
    (p) => p.status === "succeeded" && p.mode !== "test",
  );
  const volume = confirmed.reduce((sum, p) => sum + BigInt(p.amountRaw), 0n);
  const awaiting = payments.filter((p) =>
    ["created", "authorized", "settling"].includes(p.status),
  ).length;
  const ordered = [...confirmed].reverse();
  const highest = ordered.reduce(
    (max, p) => (BigInt(p.amountRaw) > max ? BigInt(p.amountRaw) : max),
    1n,
  );
  const points = ordered
    .map(
      (p, i) =>
        `${40 + i * (520 / Math.max(ordered.length - 1, 1))},${170 - Number((BigInt(p.amountRaw) * 130n) / highest)}`,
    )
    .join(" ");
  return (
    <div className="overview-content">
      <section className="overview-summary">
        <div className="overview-title">
          <div>
            <h1>Merchant Dashboard</h1>
            <p>Monitor your Payments and USDC received at a glance</p>
          </div>
          <span className="range-label">Latest {payments.length} Payments</span>
        </div>
        <div className="metric-grid">
          {[
            {
              label: "Total received",
              value: money(volume),
              note: `USDC · ${cluster}`,
              icon: "$",
            },
            {
              label: "Confirmed Payments",
              value: confirmed.length,
              note: "On-chain, excluding simulations",
              icon: "↗",
            },
            {
              label: "Awaiting payment",
              value: awaiting,
              note: "Not counted as received",
              icon: "◷",
            },
            {
              label: "Active API keys",
              value: activeKeys,
              note: "Your integration credentials",
              icon: "⌘",
            },
          ].map((metric) => (
            <article className="metric" key={metric.label}>
              <div className="metric-main">
                <span>{metric.label}</span>
                <span className="metric-symbol" aria-hidden="true">
                  {metric.icon}
                </span>
                <strong>{metric.value}</strong>
              </div>
              <p>{metric.note}</p>
            </article>
          ))}
        </div>
      </section>
      <div className="overview-columns">
        <div className="overview-left">
          <section className="overview-panel volume-panel">
            <div className="overview-title">
              <div>
                <h2>Payments Overview</h2>
                <p>USDC received per confirmed Payment</p>
              </div>
              <span className="range-label">{cluster}</span>
            </div>
            {ordered.length ? (
              <svg
                className="volume-chart"
                viewBox="0 0 600 220"
                role="img"
                aria-label={`${ordered.length} confirmed Payments, ${money(volume)} USDC total. Values plotted from oldest to newest.`}
              >
                {[40, 83, 126, 170].map((y, i) => (
                  <g key={y}>
                    <line
                      x1="40"
                      x2="565"
                      y1={y}
                      y2={y}
                      stroke="#ececec"
                      strokeDasharray="3 5"
                    />
                    <text x="2" y={y + 4} fill="#909090" fontSize="10">
                      {money((highest * BigInt(3 - i)) / 3n)}
                    </text>
                  </g>
                ))}
                <polyline
                  points={points}
                  fill="none"
                  stroke="#333"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                {ordered.map((p, i) => (
                  <circle
                    key={p.id}
                    cx={40 + i * (520 / Math.max(ordered.length - 1, 1))}
                    cy={170 - Number((BigInt(p.amountRaw) * 130n) / highest)}
                    r="3"
                    fill="white"
                    stroke="#333"
                  >
                    <title>
                      {p.id}: {money(BigInt(p.amountRaw))} USDC
                    </title>
                  </circle>
                ))}
                <text x="40" y="205" fill="#909090" fontSize="11">
                  Oldest shown
                </text>
                <text x="495" y="205" fill="#909090" fontSize="11">
                  Latest shown
                </text>
              </svg>
            ) : (
              <div className="chart-empty">
                Your first confirmed Payment will appear here.
              </div>
            )}
            <div className="chart-footer">
              <div>
                <strong>{money(volume)} USDC</strong>
                <span>Confirmed volume</span>
              </div>
              <div>
                <strong>{confirmed.length}</strong>
                <span>Confirmed Payments</span>
              </div>
              <div>
                <strong>{payments.length}</strong>
                <span>Recent attempts</span>
              </div>
            </div>
          </section>
          <section className="overview-panel settlement-summary">
            <h2>Your settlement account</h2>
            <p>Payments settle directly to {name} in USDC.</p>
            <div className="settlement-facts">
              <div>
                <strong>USDC on Solana</strong>
                <span>No automatic currency conversion</span>
              </div>
              <div>
                <strong>On confirmation</strong>
                <span>No automatic bank payout</span>
              </div>
            </div>
            <button className="secondary" onClick={onAccount}>
              View receiving account
            </button>
          </section>
        </div>
        <section className="overview-panel recent-panel">
          <div className="overview-title">
            <div>
              <h2>Recent Payments</h2>
              <p>Latest activity from your Checkout</p>
            </div>
          </div>
          {payments.slice(0, 5).map((p) => (
            <article className="recent-payment" key={p.id}>
              <div>
                <strong>{money(BigInt(p.amountRaw))} USDC</strong>
                <span className="payment-status" data-status={p.status}>
                  {p.status === "succeeded"
                    ? "Confirmed"
                    : p.status === "created"
                      ? "Not paid"
                      : p.status}
                </span>
              </div>
              <code>{p.id}</code>
              <span className="recent-mode">
                {p.mode === "test" ? "Simulation" : "On-chain execution"}
              </span>
            </article>
          ))}
          {!payments.length && <p>No Payments yet.</p>}
          <button className="secondary recent-view" onClick={onPayments}>
            View all Payments
          </button>
        </section>
      </div>
      <p className="dataset-note">
        Based on the latest {payments.length} Payments returned by the server.
        Not your account Balance or an all-time total.
      </p>
    </div>
  );
}
