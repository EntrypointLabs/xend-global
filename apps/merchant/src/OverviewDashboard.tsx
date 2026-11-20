import { formatUsdc as money } from "./money";
import { statusLabel } from "./PaymentsPanel";
import { CodeTabs, Icon, IntegrationSteps, PageHeader, StatusChip } from "./ui";

type Payment = { id: string; status: string; amountRaw: string; mode: string };

const W = 1000;
const H = 210;
const LEFT = 8;
const RIGHT = 70;
const TOP = 16;
const BOTTOM = 178;

function VolumeChart({
  ordered,
  volume,
}: {
  ordered: Payment[];
  volume: bigint;
}) {
  const highest = ordered.reduce(
    (max, p) => (BigInt(p.amountRaw) > max ? BigInt(p.amountRaw) : max),
    1n,
  );
  const span = W - LEFT - RIGHT;
  const x = (i: number) =>
    ordered.length === 1
      ? LEFT + span / 2
      : LEFT + (i * span) / (ordered.length - 1);
  const y = (raw: string) =>
    BOTTOM - Number((BigInt(raw) * BigInt(BOTTOM - TOP)) / highest);
  // Horizontal-tangent cubic segments: smooth, and never overshoot a point
  // the way a Catmull-Rom spline can.
  const pts = ordered.map((p, i) => [x(i), y(p.amountRaw)] as const);
  const line = pts
    .map(([px, py], i) => {
      if (i === 0) return `M ${px},${py}`;
      const [qx, qy] = pts[i - 1]!;
      const mid = (qx + px) / 2;
      return `C ${mid},${qy} ${mid},${py} ${px},${py}`;
    })
    .join(" ");
  const area = `${line} L ${x(ordered.length - 1)},${BOTTOM} L ${x(0)},${BOTTOM} Z`;
  return (
    <svg
      className="volume-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${ordered.length} confirmed Payments, ${money(volume)} USDC total. Values plotted from oldest to newest.`}
    >
      <defs>
        <linearGradient id="volume-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3].map((step) => {
        const gy = TOP + ((BOTTOM - TOP) * step) / 3;
        return (
          <g key={step}>
            <line
              x1={LEFT}
              x2={W - RIGHT + 12}
              y1={gy}
              y2={gy}
              stroke="#0a0a0a"
              strokeOpacity={step === 3 ? 0.12 : 0.06}
            />
            <text
              x={W - 2}
              y={gy + 4}
              textAnchor="end"
              fill="#0a0a0a"
              fillOpacity="0.4"
              fontSize="11"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {money((highest * BigInt(3 - step)) / 3n)}
            </text>
          </g>
        );
      })}
      {ordered.length > 1 && (
        <>
          <path d={area} fill="url(#volume-fill)" />
          <path
            d={line}
            fill="none"
            stroke="#2563eb"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </>
      )}
      {ordered.map((p, i) => (
        <circle
          key={p.id}
          cx={x(i)}
          cy={y(p.amountRaw)}
          r={i === ordered.length - 1 ? 4.5 : 3}
          fill={i === ordered.length - 1 ? "#2563eb" : "#fff"}
          stroke="#2563eb"
          strokeWidth="1.6"
        >
          <title>
            {p.id}: {money(BigInt(p.amountRaw))} USDC
          </title>
        </circle>
      ))}
      <text x={LEFT} y={H - 6} fill="#0a0a0a" fillOpacity="0.4" fontSize="11">
        Oldest shown
      </text>
      <text
        x={W - RIGHT}
        y={H - 6}
        textAnchor="end"
        fill="#0a0a0a"
        fillOpacity="0.4"
        fontSize="11"
      >
        Latest
      </text>
    </svg>
  );
}

export function OverviewDashboard({
  payments,
  activeKeys,
  cluster,
  name,
  onPayments,
  onAccount,
  onPayment,
  onDevelopers,
}: {
  payments: Payment[];
  activeKeys: number;
  cluster: string;
  name: string;
  onPayments: () => void;
  onAccount: () => void;
  onPayment?: (id: string) => void;
  onDevelopers?: () => void;
}) {
  const confirmed = payments.filter(
    (p) => p.status === "succeeded" && p.mode !== "test",
  );
  const volume = confirmed.reduce((sum, p) => sum + BigInt(p.amountRaw), 0n);
  const awaiting = payments.filter((p) =>
    ["created", "authorized", "settling"].includes(p.status),
  ).length;
  const ordered = [...confirmed].reverse();
  const attention = payments.filter((p) =>
    ["failed", "expired"].includes(p.status),
  );
  const open = (id: string) => (onPayment ? onPayment(id) : onPayments());

  return (
    <div className="overview-content">
      <PageHeader title="Home" />

      <div className="today">
        <section className="hero-card" aria-label="Received">
          <p className="hero-label">Received</p>
          <div className="hero-figure">
            <strong>{money(volume)}</strong>
            <span>USDC</span>
          </div>
          <p className="hero-caption">
            {payments.length
              ? `Confirmed on-chain across your latest ${payments.length} Payments. Simulations are not counted.`
              : "Confirmed on-chain Payments add up here. Simulations are not counted."}
          </p>
          {ordered.length ? (
            <VolumeChart ordered={ordered} volume={volume} />
          ) : (
            <div className="chart-empty">
              Your first confirmed Payment will appear here.
            </div>
          )}
          <div className="stat-row">
            <article className="stat">
              <span>Confirmed Payments</span>
              <strong>{confirmed.length}</strong>
            </article>
            <article className="stat">
              <span>Awaiting payment</span>
              <strong>{awaiting}</strong>
            </article>
            <article className="stat">
              <span>Active API keys</span>
              <strong>{activeKeys}</strong>
            </article>
          </div>
        </section>

        <aside className="today-side">
          <section className="panel-grey">
            <h2>Settlement</h2>
            <p>Payments settle directly to {name}.</p>
            <div className="kv-row">
              <span>Asset</span>
              <strong>USDC on Solana</strong>
            </div>
            <div className="kv-row">
              <span>Network</span>
              <strong className="network-name">{cluster}</strong>
            </div>
            <div className="kv-row">
              <span>Conversion</span>
              <strong>None automatic</strong>
            </div>
            <button className="link panel-link" onClick={onAccount}>
              View receiving account
            </button>
          </section>
          {onDevelopers && (
            <section className="panel-grey">
              <h2>API keys</h2>
              <p>Your server creates Payments with a secret key.</p>
              <div className="kv-row">
                <span>Active keys</span>
                <strong>{activeKeys}</strong>
              </div>
              <button className="link panel-link" onClick={onDevelopers}>
                Go to API keys
              </button>
            </section>
          )}
        </aside>
      </div>

      {payments.length === 0 ? (
        <section>
          <div className="section-label">
            <div>
              <h2>Take your first Payment</h2>
              <p>No Payments yet.</p>
            </div>
          </div>
          <div className="integrate">
            <IntegrationSteps />
            <CodeTabs tabs={["react", "script", "server"]} />
          </div>
          <div className="card-foot">
            <button className="secondary small" onClick={onPayments}>
              View all Payments
            </button>
          </div>
        </section>
      ) : (
        <section>
          <div className="section-label">
            <h2>Your overview</h2>
          </div>
          <div className="overview-grid">
            <section className="card">
              <div className="card-head">
                <h2>Recent Payments</h2>
                <button className="link" onClick={onPayments}>
                  View all Payments
                </button>
              </div>
              <div className="row-list">
                {payments.slice(0, 6).map((p) => (
                  <button
                    type="button"
                    className="list-row"
                    key={p.id}
                    onClick={() => open(p.id)}
                  >
                    <div>
                      <strong>{money(BigInt(p.amountRaw))} USDC</strong>
                      <small>
                        <span>
                          {p.mode === "test" ? "Simulation" : "On-chain"}
                        </span>
                        {" · "}
                        <code>{p.id}</code>
                      </small>
                    </div>
                    <StatusChip status={p.status}>
                      {statusLabel(p.status)}
                    </StatusChip>
                    <Icon name="chevron" size={16} />
                  </button>
                ))}
              </div>
            </section>
            <section className="card">
              <div className="card-head">
                <h2>Failed and expired</h2>
              </div>
              {attention.length ? (
                <div className="row-list">
                  {attention.slice(0, 4).map((p) => (
                    <button
                      type="button"
                      className="list-row"
                      key={p.id}
                      onClick={() => open(p.id)}
                    >
                      <div>
                        <strong>{money(BigInt(p.amountRaw))} USDC</strong>
                        <small>
                          <code>{p.id}</code>
                        </small>
                      </div>
                      <StatusChip status={p.status}>
                        {statusLabel(p.status)}
                      </StatusChip>
                      <Icon name="chevron" size={16} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="card-sub">Nothing failed or expired recently.</p>
              )}
            </section>
          </div>
          <p className="dataset-note">
            Based on the latest {payments.length} Payments returned by the
            server. Not your account Balance or an all-time total.
          </p>
        </section>
      )}
    </div>
  );
}
