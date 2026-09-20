import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  PrivyProvider,
  useIdentityToken,
  usePrivy,
} from "@privy-io/react-auth";
import "./style.css";
import { useMerchantDashboard } from "./useMerchantDashboard";
import { KeyReveal } from "./KeyReveal";
import { MerchantSessionBoundary } from "./MerchantSessionBoundary";
import { MerchantEntryBrand, MerchantEntryStory } from "./MerchantEntry";
import { RevokeKey } from "./RevokeKey";
import { OverviewDashboard } from "./OverviewDashboard";
import { PortalRequestError } from "./PortalRequestError";
import "./workspace.css";
import {
  BusinessProfileForm,
  type ProfileMerchant,
  type BusinessProfileHandle,
} from "./BusinessProfileForm";
import { createPortalClient } from "./portal";
import { navigate, pagePath, useRoute } from "./router";
import { WebhooksPanel } from "./WebhooksPanel";
import { PaymentsPanel } from "./PaymentsPanel";
import { PaymentDetail } from "./PaymentDetail";
import { AuditPanel } from "./AuditPanel";

type ApiKey = {
  id: string;
  name: string | null;
  fingerprint: string;
  mode: string;
  executionCluster: string | null;
  rotatedFromId: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type Dashboard = {
  cluster: string;
  devnetExecutionEnabled: boolean;
  merchant: ProfileMerchant & {
    id: string;
    displayName: string;
    kybStatus: string;
    kybSubmittedAt: string | null;
    kybReviewNote: string | null;
    receivingWallet: string;
  };
  destination: { address: string | null } | null;
  keys: ApiKey[];
  payments: {
    id: string;
    status: string;
    amountRaw: string;
    mode: string;
    createdAt: string;
  }[];
};

function DashboardApp() {
  const { user } = usePrivy();
  return <MerchantWorkspace key={user?.id ?? "signed-out"} />;
}

function keyKind(key: ApiKey): string {
  if (key.executionCluster === "devnet") return "Devnet execution key";
  return key.mode === "test" ? "Simulation key" : "Live execution key";
}

function whenText(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "Never";
}

function MerchantWorkspace() {
  const profileRef = useRef<BusinessProfileHandle>(null);
  const route = useRoute();
  const [developerTab, setDeveloperTab] = useState<"keys" | "guide">("keys");
  const { ready, authenticated, login, logout } = usePrivy();
  const { identityToken } = useIdentityToken();
  const client = useMemo(
    () => createPortalClient(authenticated ? identityToken : null),
    [authenticated, identityToken],
  );
  const account = useMerchantDashboard<Dashboard>(
    authenticated ? identityToken : null,
  );
  const { data, setData } = account;
  // Track the path we are on so the browser-history guard below can tell what
  // page a back/forward is leaving.
  const currentPathRef = useRef(pagePath("overview"));
  useEffect(() => {
    currentPathRef.current = window.location.pathname;
  });
  useEffect(() => {
    // Back/forward fire popstate directly, bypassing the click guard. If it
    // leaves the account page with unsaved edits and the owner declines to
    // discard, re-push the account path to cancel the transition.
    const onPopState = () => {
      const wasAccount = currentPathRef.current === pagePath("account");
      const now = window.location.pathname;
      if (
        wasAccount &&
        now !== pagePath("account") &&
        profileRef.current &&
        !profileRef.current.canLeave()
      ) {
        window.history.pushState(null, "", pagePath("account"));
        window.dispatchEvent(new Event("locationchange"));
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("http://localhost:5174");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One-time secrets (API keys and webhook signing secrets) are revealed once.
  // Held at the workspace level and shown above the routed content so switching
  // pages never discards the only copy the merchant is given.
  const [secretReveal, setSecretReveal] = useState<{
    secret: string;
    label: string;
  } | null>(null);
  const [keyName, setKeyName] = useState("");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof PortalRequestError || e instanceof Error
          ? e.message
          : "Request failed",
      );
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setData(await client.get<Dashboard>("me"));
  }
  async function issue(mode: "test" | "live" | "devnet") {
    const key = await client.post<{ raw: string }>("keys", {
      mode,
      name: keyName.trim() || undefined,
    });
    setSecretReveal({ secret: key.raw, label: "API key" });
    setKeyName("");
    await refresh();
  }
  async function rotate(id: string) {
    const key = await client.post<{ raw: string }>(
      `keys/${encodeURIComponent(id)}/rotate`,
    );
    setSecretReveal({ secret: key.raw, label: "New API key" });
    await refresh();
  }

  const page = route.page;
  // History-API navigation does not fire the form's beforeunload warning, and
  // routing away unmounts the account form with its draft. Guard every in-app
  // navigation so leaving the account page with unsaved edits asks first.
  function go(to: string) {
    if (
      route.page === "account" &&
      profileRef.current &&
      !profileRef.current.canLeave()
    )
      return;
    navigate(to);
  }
  const navItem = (
    target: Parameters<typeof pagePath>[0],
    label: string,
    active: boolean,
  ) => (
    <button
      className={active ? "selected" : ""}
      aria-current={active ? "page" : undefined}
      onClick={() => go(pagePath(target))}
    >
      {label}
    </button>
  );

  return (
    <MerchantSessionBoundary
      ready={ready}
      authenticated={authenticated}
      accountLoading={account.status === "loading"}
    >
      <div
        className={`shell ${data ? "workspace" : "merchant-entry"}`}
        data-page={page}
      >
        {!data && <MerchantEntryStory />}
        {data && (
          <aside>
            <a
              className="wordmark"
              href={pagePath("overview")}
              onClick={(e) => {
                e.preventDefault();
                go(pagePath("overview"));
              }}
            >
              <span className="version-pill">v1</span>
              <span className="brand-symbol" aria-hidden="true">
                ↗
              </span>
              xend
            </a>
            <nav aria-label="Merchant workspace">
              {navItem("overview", "Home", page === "overview")}
              {navItem(
                "payments",
                "Payments",
                page === "payments" || page === "payment",
              )}
              {navItem("developers", "Developers", page === "developers")}
              {navItem("webhooks", "Webhooks", page === "webhooks")}
              {navItem("audit", "Activity", page === "audit")}
              {authenticated &&
                navItem("account", "Account", page === "account")}
            </nav>
            <div className="sidebar-note">
              Your business.
              <br />
              Paid in digital dollars.
            </div>
          </aside>
        )}
        <main id="overview" aria-busy={busy}>
          {!data && <MerchantEntryBrand />}
          {data && (
            <header>
              <span className="eyebrow">MERCHANT WORKSPACE</span>
              <div>
                {data && <span className="badge">{data.cluster}</span>}
                {authenticated && (
                  <button
                    className="quiet"
                    onClick={() => {
                      if (profileRef.current && !profileRef.current.canLeave())
                        return;
                      setData(null);
                      setSecretReveal(null);
                      void logout();
                    }}
                  >
                    Sign out
                  </button>
                )}
              </div>
            </header>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {secretReveal && (
            <KeyReveal
              key={secretReveal.secret}
              secret={secretReveal.secret}
              label={secretReveal.label}
              onDismiss={() => setSecretReveal(null)}
            />
          )}
          {!authenticated ? (
            <section className="panel">
              <h2>Your business starts here.</h2>
              <p>
                Sign in to create your receiving account, manage integration
                keys and track Payments.
              </p>
              <button disabled={!ready} onClick={login}>
                Continue
              </button>
            </section>
          ) : account.status === "loading" ? (
            <section className="panel" role="status" aria-live="polite">
              <h2>Opening your workspace</h2>
              <p>Checking your Merchant account…</p>
            </section>
          ) : account.status === "error" ? (
            <section className="panel">
              <h2>Your workspace couldn’t load</h2>
              <p role="alert">{account.error}</p>
              <button onClick={account.retry}>Try again</button>
            </section>
          ) : !data ? (
            <section className="panel" id="setup">
              <p className="eyebrow">01 / SET UP YOUR BUSINESS</p>
              <h2>Make it yours.</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    setData(
                      await client.post<Dashboard>("register", {
                        name,
                        origin,
                        acceptUsdcTerms: accepted,
                      }),
                    );
                  });
                }}
              >
                <label>
                  Business name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    minLength={2}
                    maxLength={100}
                  />
                </label>
                <label>
                  Store origin
                  <input
                    type="url"
                    value={origin}
                    onChange={(e) => setOrigin(e.target.value)}
                    required
                  />
                  <small>
                    Your store’s HTTPS origin. Localhost is supported for
                    development.
                  </small>
                </label>
                <label className="consent">
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                    required
                  />
                  <span>
                    I understand that Payments settle in USDC on Solana. Xend
                    does not automatically convert proceeds or send bank
                    payouts. Later conversion uses my chosen provider’s rates
                    and fees.
                  </span>
                </label>
                <div className="actions">
                  <button disabled={busy || !identityToken}>Continue</button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => void run(refresh)}
                  >
                    Open existing account
                  </button>
                </div>
              </form>
            </section>
          ) : page === "overview" ? (
            <OverviewDashboard
              payments={data.payments}
              activeKeys={data.keys.filter((key) => !key.revokedAt).length}
              cluster={data.cluster}
              name={data.merchant.displayName}
              onPayments={() => navigate(pagePath("payments"))}
              onAccount={() => navigate(pagePath("account"))}
            />
          ) : page === "payments" ? (
            <PaymentsPanel client={client} />
          ) : page === "payment" && route.paymentId ? (
            <PaymentDetail client={client} paymentId={route.paymentId} />
          ) : page === "webhooks" ? (
            <WebhooksPanel
              client={client}
              onSecret={(secret, label) => setSecretReveal({ secret, label })}
              revealActive={secretReveal !== null}
              cluster={data.cluster}
            />
          ) : page === "audit" ? (
            <AuditPanel client={client} />
          ) : page === "account" ? (
            <section className="account-workspace" id="setup">
              <div className="workspace-page-title">
                <h1>Merchant Account</h1>
                <p>
                  Receiving details and business verification for{" "}
                  {data.merchant.displayName}
                </p>
              </div>
              <div className="grid">
                <section className="panel">
                  <p className="eyebrow">01 / RECEIVING ACCOUNT</p>
                  <h2>
                    {data.destination
                      ? "Receiving account connected."
                      : "Give payments a home."}
                  </h2>
                  <p>
                    Merchant-controlled USDC on Solana. Network: {data.cluster}.
                  </p>
                  <code className="address">
                    {data.destination?.address ?? data.merchant.receivingWallet}
                  </code>
                  {!data.destination && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await client.post("destination");
                          await refresh();
                        })
                      }
                    >
                      Initialize USDC account ↗
                    </button>
                  )}
                </section>
                <section className="panel">
                  <p className="eyebrow">02 / BUSINESS VERIFICATION</p>
                  <h2>
                    {data.merchant.kybStatus === "verified"
                      ? "Verified."
                      : data.merchant.kybStatus === "rejected"
                        ? "Verification not approved."
                        : data.merchant.kybSubmittedAt
                          ? "Verification in review."
                          : "Verification pending."}
                  </h2>
                  <p>
                    Test keys are available now. Live keys require business
                    verification and a confirmed receiving account.
                  </p>
                  {data.merchant.kybStatus === "rejected" &&
                    data.merchant.kybReviewNote && (
                      <p className="error" role="status">
                        {data.merchant.kybReviewNote}
                      </p>
                    )}
                  {data.merchant.kybStatus !== "verified" && (
                    <>
                      {data.merchant.kybSubmittedAt &&
                        data.merchant.kybStatus === "pending" && (
                          <p className="subtle">
                            Submitted for review on{" "}
                            {whenText(data.merchant.kybSubmittedAt)}.
                          </p>
                        )}
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            // The draft lives in the profile form; submitting
                            // while it is dirty would send the old persisted
                            // profile for review while the owner sees unsaved
                            // values. Require a save first.
                            if (profileRef.current?.isDirty()) {
                              throw new Error(
                                "Save your business details before submitting them for verification.",
                              );
                            }
                            setData(await client.post<Dashboard>("kyb/submit"));
                          })
                        }
                      >
                        {data.merchant.kybStatus === "rejected"
                          ? "Resubmit for verification"
                          : data.merchant.kybSubmittedAt
                            ? "Resubmit business details"
                            : "Submit business details for verification"}
                      </button>
                    </>
                  )}
                  <p className="subtle">
                    Devnet setup does not represent completed business
                    verification.
                  </p>
                </section>
              </div>
              <p className="account-settlement-note">
                Payments settle in USDC when confirmed on Solana. No automatic
                currency conversion or bank payout.
              </p>
              <BusinessProfileForm
                ref={profileRef}
                key={data.merchant.id}
                merchant={data.merchant}
                onSave={async (update) => {
                  const next = await client.post<Dashboard>("profile", update);
                  setData(next);
                  return next.merchant;
                }}
              />
            </section>
          ) : (
            <section className="panel developer-workspace" id="keys">
              <div className="developer-sidebar">
                <h2>Settings</h2>
                <p>MERCHANT SETTINGS</p>
                <button onClick={() => navigate(pagePath("account"))}>
                  Receiving account
                </button>
                <button onClick={() => navigate(pagePath("account"))}>
                  Business verification
                </button>
                <p>INTEGRATION</p>
                <button
                  className={developerTab === "keys" ? "selected" : ""}
                  aria-current={developerTab === "keys" ? "page" : undefined}
                  onClick={() => setDeveloperTab("keys")}
                >
                  API keys & SDKs
                </button>
                <button
                  className={developerTab === "guide" ? "selected" : ""}
                  aria-current={developerTab === "guide" ? "page" : undefined}
                  onClick={() => setDeveloperTab("guide")}
                >
                  Integration guide
                </button>
                <p>EVENTS</p>
                <button onClick={() => navigate(pagePath("webhooks"))}>
                  Webhooks
                </button>
              </div>
              <div className="developer-main">
                <div className="developer-breadcrumb">
                  Settings <span>/</span>{" "}
                  {developerTab === "guide"
                    ? "Integration guide"
                    : "API keys & SDKs"}
                </div>
                <div className="developer-tabs">
                  <button
                    className={developerTab === "keys" ? "selected" : ""}
                    aria-pressed={developerTab === "keys"}
                    onClick={() => setDeveloperTab("keys")}
                  >
                    API keys
                  </button>
                  <button
                    className={developerTab === "guide" ? "selected" : ""}
                    aria-pressed={developerTab === "guide"}
                    onClick={() => setDeveloperTab("guide")}
                  >
                    Integration guide
                  </button>
                </div>
                {developerTab === "guide" ? (
                  <div className="integration-guide">
                    <h2>Connect your Checkout</h2>
                    <p>
                      Create an API key for your environment. Keep the secret on
                      your server.
                    </p>
                    <ol>
                      <li>
                        Your server creates a Payment intent with the Merchant
                        API.
                      </li>
                      <li>
                        Pass the returned reference to the Xend Checkout SDK.
                      </li>
                      <li>
                        Verify the signed webhook before fulfilling the order. A
                        browser redirect alone is not proof of payment.
                      </li>
                    </ol>
                    <p>
                      Test keys simulate Payments. Devnet execution keys move
                      test USDC. Neither proves mainnet readiness.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="section-head">
                      <div>
                        <p className="eyebrow">03 / INTEGRATE</p>
                        <h2>API keys & SDKs</h2>
                      </div>
                    </div>
                    <div className="key-create">
                      <label>
                        Key name (optional)
                        <input
                          value={keyName}
                          maxLength={60}
                          placeholder="Storefront, staging, mobile app…"
                          onChange={(e) => setKeyName(e.target.value)}
                        />
                      </label>
                      <div className="actions">
                        <button
                          disabled={busy || secretReveal !== null}
                          onClick={() => void run(() => issue("test"))}
                        >
                          Create simulation key
                        </button>
                        {data.cluster !== "devnet" && (
                          <button
                            className="secondary"
                            disabled={
                              busy ||
                              secretReveal !== null ||
                              data.merchant.kybStatus !== "verified" ||
                              !data.destination
                            }
                            onClick={() => void run(() => issue("live"))}
                          >
                            Create live key
                          </button>
                        )}
                        {data.devnetExecutionEnabled && (
                          <button
                            disabled={
                              busy || secretReveal !== null || !data.destination
                            }
                            onClick={() => void run(() => issue("devnet"))}
                          >
                            Create devnet execution key
                          </button>
                        )}
                      </div>
                      {secretReveal !== null && (
                        <small>
                          Copy and dismiss the secret above before creating or
                          rotating another key.
                        </small>
                      )}
                    </div>
                    <p>
                      Simulation keys test Payments without moving USDC. Live
                      keys use the configured network shown above.
                      {data.devnetExecutionEnabled &&
                        " Devnet execution keys move test USDC only and are rejected on mainnet. They do not complete business verification."}
                    </p>
                    <div className="key-cards">
                      {data.keys.length === 0 && (
                        <p>
                          No API keys yet. Create a simulation key to start your
                          integration.
                        </p>
                      )}
                      {data.keys.map((key) => (
                        <article className="key-card" key={key.id}>
                          <div className="section-head">
                            <h3>{key.name ? key.name : keyKind(key)}</h3>
                            <span className="badge">
                              {key.revokedAt ? "Revoked" : "Active"}
                            </span>
                          </div>
                          {key.name && <small>{keyKind(key)}</small>}
                          <code className="address">{key.fingerprint}</code>
                          <small>
                            Created {whenText(key.createdAt)} · Last used{" "}
                            {whenText(key.lastUsedAt)}
                            {key.rotatedFromId
                              ? " · rotated from a prior key"
                              : ""}
                          </small>
                          {!key.revokedAt && (
                            <div className="key-card-actions actions">
                              <button
                                className="secondary"
                                disabled={busy || secretReveal !== null}
                                onClick={() => void run(() => rotate(key.id))}
                              >
                                Rotate key
                              </button>
                              <RevokeKey
                                fingerprint={key.fingerprint}
                                onRevoke={async () => {
                                  const revoked = await client.post<{
                                    revokedAt: string;
                                  }>(
                                    `keys/${encodeURIComponent(key.id)}/revoke`,
                                  );
                                  setData((current) =>
                                    current
                                      ? {
                                          ...current,
                                          keys: current.keys.map((item) =>
                                            item.id === key.id
                                              ? {
                                                  ...item,
                                                  revokedAt: revoked.revokedAt,
                                                }
                                              : item,
                                          ),
                                        }
                                      : current,
                                  );
                                  setSecretReveal(null);
                                }}
                              />
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                    <div className="key-security">
                      <strong>Security best practices</strong>
                      <ul>
                        <li>
                          Never share API keys publicly or commit them to
                          version control.
                        </li>
                        <li>
                          Store secrets on your server, not in browser or mobile
                          code.
                        </li>
                        <li>
                          Verify webhook signatures before fulfilling Payments.
                        </li>
                        <li>
                          Use a separate key for each integration environment.
                        </li>
                      </ul>
                    </div>
                  </>
                )}
              </div>
            </section>
          )}
          {data && (
            <footer>
              Built for business. Settled in USDC.
              <span>Bank payouts are not available in V1.</span>
            </footer>
          )}
        </main>
      </div>
    </MerchantSessionBoundary>
  );
}

const appId = import.meta.env.VITE_PRIVY_APP_ID;
createRoot(document.getElementById("root")!).render(
  appId ? (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "passkey"],
        embeddedWallets: { solana: { createOnLogin: "users-without-wallets" } },
      }}
    >
      <DashboardApp />
    </PrivyProvider>
  ) : (
    <p>Configure VITE_PRIVY_APP_ID to start the Merchant dashboard.</p>
  ),
);
