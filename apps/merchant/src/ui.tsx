import { useState, type ReactNode } from "react";

export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size * (214 / 208)}
      viewBox="0 0 208 214"
      aria-hidden="true"
      className="mark"
    >
      <path
        transform="translate(4 6)"
        fill="currentColor"
        d="M 48 40 L 94 40 C 102 40 107 35 113 29 L 119 23 C 123 19 127 18 135 18 L 180 18 L 180 158 C 180 163 177 166 172 166 L 114 166 C 112 166 110 167 108 169 L 94 182 C 92 184 90 184 87 184 L 28 184 C 23 184 20 181 20 176 L 20 91 C 20 85 24 82 30 82 L 58 82 L 58 144 C 58 147 60 149 63 149 L 86 149 C 89 149 91 148 94 145 L 110 129 C 112 127 115 126 119 126 L 143 126 L 143 59 L 133 59 C 125 59 119 65 114 71 C 109 76 104 78 96 78 L 58 78 C 45 78 36 58 36 50 C 36 44 42 40 48 40 Z"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark-lockup">
      <Mark size={18} />
      <span>PRYDD</span>
    </span>
  );
}

const ICONS: Record<string, ReactNode> = {
  home: (
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
  ),
  payments: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="3" />
      <path d="M2.5 10h19M6.5 15h4" />
    </>
  ),
  code: <path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16" />,
  webhook: (
    <>
      <circle cx="6" cy="17" r="2.5" />
      <circle cx="18" cy="17" r="2.5" />
      <circle cx="12" cy="6" r="2.5" />
      <path d="M10.7 8.2 7.2 14.8M8.5 17h7M13.3 8.2l3.5 6.6" />
    </>
  ),
  activity: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  account: (
    <>
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M5 10v8M9.7 10v8M14.3 10v8M19 10v8M3 20.5h18" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
      <path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  key: (
    <>
      <circle cx="8" cy="15" r="4.5" />
      <path d="m11.2 11.8 8.3-8.3M16.5 6.5l2.5 2.5M14 9l2 2" />
    </>
  ),
  shield: (
    <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6z" />
  ),
  signout: (
    <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10" />
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6 6 18" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  warning: (
    <>
      <path d="M10.3 4.2 2.9 17.5a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4.5M12 17.2v.3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.6v.4" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
}: {
  name: keyof typeof ICONS;
  size?: number;
}) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

const TONE: Record<string, "success" | "danger" | "pending" | "muted"> = {
  succeeded: "success",
  delivered: "success",
  failed: "danger",
  exhausted: "danger",
  canceled: "muted",
  expired: "muted",
  created: "muted",
  authorized: "pending",
  settling: "pending",
  pending: "pending",
  retrying: "pending",
};

export function StatusChip({
  status,
  children,
}: {
  status: string;
  children: ReactNode;
}) {
  return (
    <span
      className="chip"
      data-tone={TONE[status] ?? "muted"}
      data-status={status}
    >
      {children}
    </span>
  );
}

export function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={15} />
    </button>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="loading-block" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skeleton-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} style={{ animationDelay: `${i * 80}ms` }} />
      ))}
    </div>
  );
}

export function ErrorCard({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-card">
      <strong>{title}</strong>
      <p role="alert">{message}</p>
      {onRetry && (
        <button type="button" className="secondary small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

const API = "https://api.prydd.co";

export const SNIPPETS = {
  server: {
    label: "Server",
    language: "Node",
    code: `// POST /api/prydd/intent on your server. The key never reaches the browser.
const res = await fetch("${API}/v1/payment_intents", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.PRYDD_SECRET_KEY}\`,
    "Content-Type": "application/json",
    "Idempotency-Key": order.id,
  },
  body: JSON.stringify({
    amount: "450000",          // minor units: ₦4,500.00
    currency: "NGN",           // NGN, USD or USDC
    merchant_reference: order.id,
  }),
});
const intent = await res.json();
return { reference: intent.id };`,
  },
  react: {
    label: "React",
    language: "npm i @prydd/checkout-react",
    code: `import { PryddPayButton } from "@prydd/checkout-react";

export function Checkout() {
  return (
    <PryddPayButton
      createIntent={async () => {
        const res = await fetch("/api/prydd/intent", { method: "POST" });
        return res.json(); // { reference }
      }}
      onResult={({ reference, status }) => {
        // Confirm on your server before fulfilling.
      }}
    />
  );
}`,
  },
  script: {
    label: "Script tag",
    language: "HTML",
    code: `<script src="https://unpkg.com/@prydd/checkout-core/dist/prydd-checkout.iife.js"></script>
<div id="pay"></div>
<script>
  PryddCheckout.mountPryddButton({
    mount: document.getElementById("pay"),
    createIntent: async () => {
      const res = await fetch("/api/prydd/intent", { method: "POST" });
      return res.json(); // { reference }
    },
    onResult: ({ reference, status }) => {
      // Confirm on your server before fulfilling.
    },
  });
</script>`,
  },
  confirm: {
    label: "Confirm",
    language: "Node",
    code: `// Before you ship the order, ask Prydd what actually happened.
const res = await fetch(\`${API}/v1/payment_intents/\${reference}\`, {
  headers: { Authorization: \`Bearer \${process.env.PRYDD_SECRET_KEY}\` },
});
const intent = await res.json();
if (intent.status === "succeeded") fulfill(intent.merchant_reference);`,
  },
  verify: {
    label: "Verify webhook",
    language: "Node",
    code: `import { verifyWebhook } from "@prydd/checkout-core/webhook";

// Pass the raw body: re-serialised JSON breaks the signature.
const raw = express.raw({ type: "application/json" });

app.post("/webhooks/prydd", raw, (req, res) => {
  const event = verifyWebhook(
    req.body,
    req.headers,
    process.env.PRYDD_WEBHOOK_SECRET,
  );
  if (event.type === "payment.succeeded") {
    fulfill(event.data.object.merchant_reference);
  }
  res.sendStatus(200);
});`,
  },
} as const;

export type SnippetKey = keyof typeof SNIPPETS;

export function CodeTabs({
  tabs,
  label = "Integration code",
}: {
  tabs: SnippetKey[];
  label?: string;
}) {
  const [active, setActive] = useState<SnippetKey>(tabs[0]!);
  const snippet = SNIPPETS[active];
  return (
    <div className="code-tabs">
      <div className="code-tabs-bar">
        <div role="tablist" aria-label={label}>
          {tabs.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={key === active}
              onClick={() => setActive(key)}
            >
              {SNIPPETS[key].label}
            </button>
          ))}
        </div>
        <span className="code-lang">{snippet.language}</span>
        <CopyButton value={snippet.code} label={`Copy ${snippet.label} code`} />
      </div>
      <pre role="tabpanel">
        <code>{snippet.code}</code>
      </pre>
    </div>
  );
}

export function IntegrationSteps() {
  return (
    <ol className="integration-steps">
      <li>
        <span>1</span>
        <div>
          <strong>Create a key</strong>
          <p>Start with a simulation key. It never moves money.</p>
        </div>
      </li>
      <li>
        <span>2</span>
        <div>
          <strong>Create the intent on your server</strong>
          <p>Your server asks Prydd for a reference with the amount.</p>
        </div>
      </li>
      <li>
        <span>3</span>
        <div>
          <strong>Drop in the button</strong>
          <p>React component or a script tag. The sheet opens on your page.</p>
        </div>
      </li>
      <li>
        <span>4</span>
        <div>
          <strong>Confirm before you ship</strong>
          <p>
            A browser result is not proof of payment. Check from your server.
          </p>
        </div>
      </li>
    </ol>
  );
}
