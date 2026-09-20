import { formatUsdc } from "./money";
import React, { useRef, useState } from "react";
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

type Dashboard = {
  cluster: string;
  devnetExecutionEnabled: boolean;
  merchant: ProfileMerchant & {
    id: string;
    displayName: string;
    kybStatus: string;
    receivingWallet: string;
  };
  destination: { address: string } | null;
  keys: {
    id: string;
    fingerprint: string;
    mode: string;
    executionCluster: string | null;
    revokedAt: string | null;
  }[];
  payments: { id: string; status: string; amountRaw: string; mode: string }[];
};

function DashboardApp() {
  const { user } = usePrivy();
  return <MerchantWorkspace key={user?.id ?? "signed-out"} />;
}

function MerchantWorkspace() {
  const profileRef = useRef<BusinessProfileHandle>(null);
  const [page, setPage] = useState<
    "overview" | "account" | "keys" | "payments"
  >("overview");
  const [developerTab, setDeveloperTab] = useState<"keys" | "guide">("keys");
  const { ready, authenticated, login, logout } = usePrivy();
  const { identityToken } = useIdentityToken();
  const account = useMerchantDashboard<Dashboard>(
    authenticated ? identityToken : null,
  );
  const { data, setData } = account;
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("http://localhost:5174");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rawKey, setRawKey] = useState("");

  async function request(path: string, body?: unknown) {
    if (!identityToken)
      throw new Error(
        "Your Merchant identity token is unavailable. Refresh this page. If this continues, enable ‘Return user data in an identity token’ in the Merchant Privy app’s Authentication settings.",
      );
    const response = await fetch(`/merchant-portal/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${identityToken}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new PortalRequestError(result);
    return result;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setData(await request("me"));
  }
  async function issue(mode: "test" | "live" | "devnet") {
    const key = await request("keys", { mode });
    setRawKey(key.raw);
    await refresh();
  }

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
            <a className="wordmark" href="/">
              <span className="version-pill">v1</span>
              <span className="brand-symbol" aria-hidden="true">
                ↗
              </span>
              xend
            </a>
            <nav aria-label="Merchant workspace">
              <button
                className={page === "overview" ? "selected" : ""}
                aria-current={page === "overview" ? "page" : undefined}
                onClick={() => setPage("overview")}
              >
                Home
              </button>
              {data && (
                <button
                  className={page === "payments" ? "selected" : ""}
                  aria-current={page === "payments" ? "page" : undefined}
                  onClick={() => setPage("payments")}
                >
                  Payments
                </button>
              )}
              {data && (
                <button
                  className={page === "keys" ? "selected" : ""}
                  aria-current={page === "keys" ? "page" : undefined}
                  onClick={() => setPage("keys")}
                >
                  Developers
                </button>
              )}
              {authenticated && (
                <button
                  className={page === "account" ? "selected" : ""}
                  aria-current={page === "account" ? "page" : undefined}
                  onClick={() => setPage("account")}
                >
                  Account
                </button>
              )}
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
                      setRawKey("");
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
                      await request("register", {
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
          ) : (
            <>
              {page === "overview" && (
                <OverviewDashboard
                  payments={data.payments}
                  activeKeys={data.keys.filter((key) => !key.revokedAt).length}
                  cluster={data.cluster}
                  name={data.merchant.displayName}
                  onPayments={() => setPage("payments")}
                  onAccount={() => setPage("account")}
                />
              )}
              <section
                className="account-workspace"
                id="setup"
                hidden={page !== "account"}
              >
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
                      Merchant-controlled USDC on Solana. Network:{" "}
                      {data.cluster}.
                    </p>
                    <code className="address">
                      {data.destination?.address ??
                        data.merchant.receivingWallet}
                    </code>
                    {!data.destination && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await request("destination", {});
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
                          : "Verification pending."}
                    </h2>
                    <p>
                      Test keys are available now. Live keys require business
                      verification and a confirmed receiving account.
                    </p>
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
                    const next: Dashboard = await request("profile", update);
                    setData(next);
                    return next.merchant;
                  }}
                />
              </section>
              <section
                className="panel developer-workspace"
                id="keys"
                hidden={page !== "keys"}
              >
                <div className="developer-sidebar">
                  <h2>Settings</h2>
                  <p>MERCHANT SETTINGS</p>
                  <button onClick={() => setPage("account")}>
                    Receiving account
                  </button>
                  <button onClick={() => setPage("account")}>
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
                </div>
                <div className="developer-main">
                  <div className="developer-breadcrumb">
                    Settings <span>/</span> API keys & SDKs
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
                        Create an API key for your environment. Keep the secret
                        on your server.
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
                          Verify the signed webhook before fulfilling the order.
                          A browser redirect alone is not proof of payment.
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
                        <div className="actions">
                          <button
                            disabled={busy}
                            onClick={() => void run(() => issue("test"))}
                          >
                            Create simulation key
                          </button>
                          <button
                            className="secondary"
                            disabled={
                              busy ||
                              data.merchant.kybStatus !== "verified" ||
                              !data.destination
                            }
                            onClick={() => void run(() => issue("live"))}
                          >
                            Create live key
                          </button>
                          {data.devnetExecutionEnabled && (
                            <button
                              disabled={busy || !data.destination}
                              onClick={() => void run(() => issue("devnet"))}
                            >
                              Create devnet execution key
                            </button>
                          )}
                        </div>
                      </div>
                      <p>
                        Simulation keys test Payments without moving USDC. Live
                        keys use the configured network shown above.
                        {data.devnetExecutionEnabled &&
                          " Devnet execution keys move test USDC only and are rejected on mainnet. They do not complete business verification."}
                      </p>
                      {rawKey && (
                        <KeyReveal
                          key={rawKey}
                          secret={rawKey}
                          onDismiss={() => setRawKey("")}
                        />
                      )}
                      <div className="key-cards">
                        {data.keys.length === 0 && (
                          <p>
                            No API keys yet. Create a simulation key to start
                            your integration.
                          </p>
                        )}
                        {data.keys.map((key) => (
                          <article className="key-card" key={key.id}>
                            <div className="section-head">
                              <h3>
                                {key.executionCluster === "devnet"
                                  ? "Devnet execution key"
                                  : key.mode === "test"
                                    ? "Simulation key"
                                    : "Live execution key"}
                              </h3>
                              <span className="badge">
                                {key.revokedAt ? "Revoked" : "Active"}
                              </span>
                            </div>
                            <code className="address">{key.fingerprint}</code>
                            <small>
                              Fingerprint only. Full secrets are shown once,
                              when created.
                            </small>
                            {!key.revokedAt && (
                              <RevokeKey
                                fingerprint={key.fingerprint}
                                onRevoke={async () => {
                                  const revoked = await request(
                                    `keys/${encodeURIComponent(key.id)}/revoke`,
                                    {},
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
                                  setRawKey("");
                                }}
                              />
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
                            Store secrets on your server, not in browser or
                            mobile code.
                          </li>
                          <li>
                            Verify webhook signatures before fulfilling
                            Payments.
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
              <section
                className="panel payments-workspace"
                id="payments"
                hidden={page !== "payments"}
              >
                <div className="section-head">
                  <div className="workspace-page-title">
                    <h1>Payments</h1>
                    <p>Recent Checkout attempts and their confirmed outcomes</p>
                  </div>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void run(refresh)}
                  >
                    Refresh
                  </button>
                </div>
                {data.payments.length === 0 ? (
                  <p>No Payments yet. Your first one will appear here.</p>
                ) : (
                  <div
                    className="table-wrap"
                    role="region"
                    aria-label="Recent Payments"
                    tabIndex={0}
                  >
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Reference</th>
                          <th scope="col">USDC</th>
                          <th scope="col">Status</th>
                          <th scope="col">Mode</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.payments.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <code>{p.id}</code>
                            </td>
                            <td>{formatUsdc(p.amountRaw, { suffix: true })}</td>
                            <td>
                              <span
                                className="payment-status"
                                data-status={p.status}
                              >
                                {p.status === "succeeded"
                                  ? "Confirmed"
                                  : p.status === "created"
                                    ? "Not paid"
                                    : p.status}
                              </span>
                            </td>
                            <td>
                              {p.mode === "test"
                                ? "Simulation"
                                : "On-chain execution"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
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
