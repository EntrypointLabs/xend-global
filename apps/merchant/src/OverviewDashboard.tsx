import { useState } from "react";
import { formatUsdc as money } from "./money";
import { formatWhen, statusLabel } from "./PaymentsPanel";
import { CodeTabs, Icon, IntegrationSteps, StatusChip } from "./ui";

type Payment = {
  id: string;
  status: string;
  amountRaw: string;
  mode: string;
  createdAt?: string;
};

type Range = "today" | "week" | "all";

const RANGES: { value: Range; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "all", label: "All recent" },
];

const W = 1000;
const H = 260;
const LEFT = 64;
const RIGHT = 12;
const TOP = 14;
const BOTTOM = 222;

function shortDate(iso: string | undefined): string {
  return iso
    ? new Date(iso).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";
}

// Summary tiles read better at cents; the hero keeps full USDC precision.
function cents(raw: bigint): string {
  const rounded = (raw + 5_000n) / 10_000n;
  const whole = (rounded / 100n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${whole}.${(rounded % 100n).toString().padStart(2, "0")}`;
}

function inRange(payment: Payment, range: Range, now: number): boolean {
  if (range === "all") return true;
  if (!payment.createdAt) return false;
  const at = new Date(payment.createdAt).getTime();
  if (range === "week") return now - at <= 7 * 86_400_000;
  return new Date(at).toDateString() === new Date(now).toDateString();
}

function CopyIdButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="secondary"
      onClick={() => {
        void navigator.clipboard?.writeText(id).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={15} />
      {copied ? "Copied" : "Copy ID"}
    </button>
  );
}

function VolumeChart({
  ordered,
  volume,
}: {
  ordered: Payment[];
  volume: bigint;
}) {
  const [hover, setHover] = useState<number | null>(null);
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
  // Flat-shouldered cubic segments: the curve eases between points without
  // overshooting them.
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
  const active = hover === null ? null : ordered[hover];

  return (
    <div className="chart-frame">
      <svg
        className="volume-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${ordered.length} confirmed Payments, ${money(volume)} USDC total. Values plotted from oldest to newest.`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const vx = ((event.clientX - box.left) / box.width) * W;
          const index =
            ordered.length === 1
              ? 0
              : Math.round(((vx - LEFT) / span) * (ordered.length - 1));
          setHover(Math.max(0, Math.min(ordered.length - 1, index)));
        }}
      >
        <defs>
          <linearGradient id="volume-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#1c1c1c" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#1c1c1c" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((step) => {
          const gy = TOP + ((BOTTOM - TOP) * step) / 4;
          return (
            <g key={step}>
              <line
                x1={LEFT}
                x2={W - RIGHT}
                y1={gy}
                y2={gy}
                stroke="#1c1c1c"
                strokeOpacity="0.07"
              />
              <text
                x={LEFT - 14}
                y={gy + 4}
                textAnchor="end"
                fill="#1c1c1c"
                fillOpacity="0.5"
                fontSize="13"
              >
                {money((highest * BigInt(4 - step)) / 4n)}
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
              stroke="#1c1c1c"
              strokeWidth="2.2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        )}
        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={TOP}
            y2={BOTTOM}
            stroke="#1c1c1c"
            strokeOpacity="0.15"
          />
        )}
        {ordered.map((p, i) => (
          <circle
            key={p.id}
            cx={x(i)}
            cy={y(p.amountRaw)}
            r={hover === i ? 5 : 3}
            fill="#fff"
            stroke="#1c1c1c"
            strokeWidth="1.8"
          >
            <title>
              {p.id}: {money(BigInt(p.amountRaw))} USDC
            </title>
          </circle>
        ))}
        <text x={LEFT} y={H - 8} fill="#1c1c1c" fillOpacity="0.5" fontSize="13">
          {shortDate(ordered[0]?.createdAt) || "Oldest shown"}
        </text>
        <text
          x={W - RIGHT}
          y={H - 8}
          textAnchor="end"
          fill="#1c1c1c"
          fillOpacity="0.5"
          fontSize="13"
        >
          {shortDate(ordered[ordered.length - 1]?.createdAt) || "Latest"}
        </text>
      </svg>
      {active && hover !== null && (
        <div
          className="chart-tip"
          aria-hidden="true"
          // Positioned from the hovered point's chart coordinates.
          style={{
            left: `${(x(hover) / W) * 100}%`,
            top: `${(y(active.amountRaw) / H) * 100}%`,
          }}
        >
          <div>
            <span>Received</span>
            <strong>{money(BigInt(active.amountRaw))} USDC</strong>
          </div>
          {active.createdAt && <small>{formatWhen(active.createdAt)}</small>}
        </div>
      )}
    </div>
  );
}

export function OverviewDashboard({
  payments: allPayments,
  activeKeys,
  cluster,
  name,
  onPayments,
  onAccount,
  onPayment,
  onDevelopers,
  receivingConnected,
  kybStatus,
}: {
  payments: Payment[];
  activeKeys: number;
  cluster: string;
  name: string;
  onPayments: () => void;
  onAccount: () => void;
  onPayment?: (id: string) => void;
  onDevelopers?: () => void;
  receivingConnected?: boolean;
  kybStatus?: string;
}) {
  const [range, setRange] = useState<Range>("all");
  const [now] = useState(() => Date.now());
  const payments = allPayments.filter((p) => inRange(p, range, now));
  const confirmed = payments.filter(
    (p) => p.status === "succeeded" && p.mode !== "test",
  );
  const volume = confirmed.reduce((sum, p) => sum + BigInt(p.amountRaw), 0n);
  const awaiting = payments.filter((p) =>
    ["created", "authorized", "settling"].includes(p.status),
  ).length;
  const ordered = [...confirmed].reverse();
  const largest = confirmed.reduce(
    (max, p) => (BigInt(p.amountRaw) > max ? BigInt(p.amountRaw) : max),
    0n,
  );
  const average = confirmed.length ? volume / BigInt(confirmed.length) : 0n;
  const failed = payments.filter((p) =>
    ["failed", "expired"].includes(p.status),
  ).length;
  const simulations = payments.filter((p) => p.mode === "test").length;
  const open = (id: string) => (onPayment ? onPayment(id) : onPayments());
  const first = ordered[0]?.createdAt;
  const last = ordered[ordered.length - 1]?.createdAt;
  const rangeText =
    first && last
      ? `${shortDate(first)} to ${shortDate(last)}`
      : RANGES.find((r) => r.value === range)!.label;

  const stats = [
    {
      label: "Received",
      value: money(volume),
      unit: "USDC",
      icon: "payments" as const,
      note: "Confirmed on-chain, simulations excluded",
    },
    {
      label: "Confirmed Payments",
      value: String(confirmed.length),
      icon: "check" as const,
      note: `Settled to ${name}`,
    },
    {
      label: "Awaiting payment",
      value: String(awaiting),
      icon: "clock" as const,
      note: "Not counted as received",
    },
    {
      label: "Active API keys",
      value: String(activeKeys),
      icon: "key" as const,
      note: "Your integration credentials",
    },
  ];

  const setup = [
    {
      title: "Receiving account",
      sub: "Where your USDC lands",
      badge: receivingConnected ? "Connected" : "Not set up",
      tone: receivingConnected ? "succeeded" : "created",
      onClick: onAccount,
      label: "View receiving account",
    },
    {
      title: "Business verification",
      sub: "Needed for live keys",
      badge:
        kybStatus === "verified"
          ? "Verified"
          : kybStatus === "rejected"
            ? "Not approved"
            : "Pending",
      tone:
        kybStatus === "verified"
          ? "succeeded"
          : kybStatus === "rejected"
            ? "failed"
            : "pending",
      onClick: onAccount,
      label: "View business verification",
    },
    {
      title: "API keys",
      sub: "For your server",
      badge: `${activeKeys} active`,
      tone: activeKeys ? "succeeded" : "created",
      onClick: onDevelopers ?? onAccount,
      label: "View API keys",
    },
    {
      title: "Network",
      sub: "Where Payments settle",
      badge: cluster.charAt(0).toUpperCase() + cluster.slice(1),
      tone: "created",
      onClick: onAccount,
      label: "View network",
    },
  ];

  return (
    <div className="overview">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h1>Merchant Dashboard</h1>
            <p>Monitor your Payments and USDC received at a glance.</p>
          </div>
          <div className="segmented" role="radiogroup" aria-label="Range">
            {RANGES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={range === option.value}
                onClick={() => setRange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="stat-grid">
          {stats.map((stat) => (
            <article className="stat-card" key={stat.label}>
              <div className="stat-card-top">
                <div>
                  <span>{stat.label}</span>
                  <p className="stat-value">
                    <strong>{stat.value}</strong>
                    {stat.unit && <small>{stat.unit}</small>}
                  </p>
                </div>
                <i className="icon-tile" aria-hidden="true">
                  <Icon name={stat.icon} size={18} />
                </i>
              </div>
              <p className="stat-card-note">{stat.note}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="overview-columns">
        <div className="overview-main">
          <section className="panel chart-panel">
            <div className="panel-head">
              <div>
                <h2>Received over time</h2>
                <p>USDC per confirmed Payment, oldest to newest</p>
              </div>
              <span className="range-chip">
                <Icon name="calendar" size={15} />
                {rangeText}
              </span>
            </div>
            {ordered.length ? (
              <VolumeChart ordered={ordered} volume={volume} />
            ) : (
              <div className="chart-empty">
                Your first confirmed Payment will appear here.
              </div>
            )}
            {ordered.length > 0 && (
              <div className="mini-tiles">
                <div className="mini-tile">
                  <strong>{cents(average)} USDC</strong>
                  <p>
                    <span>Average Payment</span>
                    <b>{confirmed.length}</b>
                  </p>
                </div>
                <div className="mini-tile">
                  <strong>{cents(largest)} USDC</strong>
                  <p>
                    <span>Largest Payment</span>
                  </p>
                </div>
                <div className="mini-tile">
                  <strong>{failed}</strong>
                  <p>
                    <span>Failed or expired</span>
                    <b>of {payments.length}</b>
                  </p>
                </div>
                <div className="mini-tile">
                  <strong>{simulations}</strong>
                  <p>
                    <span>Simulations</span>
                    <b>of {payments.length}</b>
                  </p>
                </div>
              </div>
            )}
          </section>

          {allPayments.length === 0 && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Take your first Payment</h2>
                  <p>Four steps from an API key to a confirmed Payment.</p>
                </div>
              </div>
              <div className="integrate">
                <IntegrationSteps />
                <CodeTabs tabs={["react", "script", "server"]} />
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Account setup</h2>
                <p>What your business needs to take live Payments</p>
              </div>
            </div>
            <div className="setup-grid">
              {setup.map((item) => (
                <button
                  key={item.title}
                  type="button"
                  className="setup-tile"
                  aria-label={item.label}
                  onClick={item.onClick}
                >
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.sub}</span>
                  </div>
                  <span className="count-badge" data-tone={item.tone}>
                    {item.badge}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <aside className="panel overview-side">
          <div className="panel-head">
            <div>
              <h2>Recent Payments</h2>
              <p>Latest activity from your Checkout</p>
            </div>
          </div>
          {payments.length ? (
            <div className="request-list">
              {payments.slice(0, 4).map((p, index) => (
                <article className="request-card" key={p.id}>
                  <div className="request-body">
                    <div className="request-top">
                      <strong>{money(BigInt(p.amountRaw))} USDC</strong>
                      {p.createdAt && (
                        <span className="date-badge">
                          {shortDate(p.createdAt)}
                        </span>
                      )}
                    </div>
                    <p className="request-meta">
                      <StatusChip status={p.status}>
                        {statusLabel(p.status)}
                      </StatusChip>
                      <span>
                        {p.mode === "test" ? "Simulation" : "On-chain"}
                      </span>
                    </p>
                    <code className="request-id">{p.id}</code>
                  </div>
                  <div className="request-actions">
                    <button
                      type="button"
                      className={index === 0 ? undefined : "secondary"}
                      onClick={() => open(p.id)}
                    >
                      <Icon name="arrow" size={15} />
                      View details
                    </button>
                    <CopyIdButton id={p.id} />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty">
              <div className="empty-icon">
                <Icon name="payments" />
              </div>
              <p>No Payments yet.</p>
            </div>
          )}
          <button className="secondary wide" onClick={onPayments}>
            View all Payments
          </button>
        </aside>
      </div>

      {allPayments.length > 0 && (
        <p className="dataset-note">
          Based on the latest {allPayments.length} Payments returned by the
          server. Not your account Balance or an all-time total.
        </p>
      )}
    </div>
  );
}
