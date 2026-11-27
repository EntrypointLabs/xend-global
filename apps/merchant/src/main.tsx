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
import { MerchantEntryStory } from "./MerchantEntry";
import { RevokeKey } from "./RevokeKey";
import { OverviewDashboard } from "./OverviewDashboard";
import { PortalRequestError } from "./PortalRequestError";
import {
  BusinessProfileForm,
  type ProfileMerchant,
  type BusinessProfileHandle,
} from "./BusinessProfileForm";
import { createPortalClient } from "./portal";
import {
  navigate,
  normalizePath,
  pagePath,
  paymentPath,
  useRoute,
  useSearch,
  type Route,
} from "./router";
import {
  CodeTabs,
  ErrorCard,
  Icon,
  IntegrationSteps,
  PageHeader,
  StatusChip,
  Wordmark,
} from "./ui";
import { WebhooksPanel } from "./WebhooksPanel";
import { PaymentsPanel, formatWhen } from "./PaymentsPanel";
import { PaymentDetail } from "./PaymentDetail";
import { AuditPanel } from "./AuditPanel";
import { ReceivingAccount, type Destination } from "./ReceivingAccount";
import { BrandSection, type BrandMerchant } from "./BrandSection";
import {
  analytics,
  reportFailure,
  routeToScreenName,
  trackActionFailed,
} from "./analytics";

type ApiKey = {
  id: string;
  name: string | null;
  fingerprint: string;
  mode: string;
  executionCluster: string | null;
  rotatedFromId: string | null;
  rotationGraceUntil: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type Dashboard = {
  cluster: string;
  devnetExecutionEnabled: boolean;
  merchant: ProfileMerchant &
    BrandMerchant & {
      id: string;
      displayName: string;
      kybStatus: string;
      kybSubmittedAt: string | null;
      kybReviewNote: string | null;
      receivingWallet: string;
    };
  destination: Destination | null;
  nairaSettlementAvailable?: boolean;
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
  const { user, ready, authenticated } = usePrivy();
  useSessionAnalytics(ready, authenticated);
  return <MerchantWorkspace key={user?.id ?? "signed-out"} />;
}

// Lives above MerchantWorkspace because that remounts per Privy user, which
// would lose the previous sign-in state. A session restored on page load is
// not reported as a fresh sign-in.
function useSessionAnalytics(ready: boolean, authenticated: boolean) {
  const last = useRef<boolean | null>(null);
  useEffect(() => {
    if (!ready) return;
    const before = last.current;
    last.current = authenticated;
    if (before === false && authenticated) {
      analytics.track("merchant_signed_in", {});
    } else if (before === true && !authenticated) {
      analytics.track("merchant_signed_out", {});
      analytics.reset();
    }
  }, [ready, authenticated]);
}

function screenFor(route: Route): string {
  if (route.page === "payment" && route.paymentId) {
    return routeToScreenName(paymentPath(route.paymentId), {
      paymentId: encodeURIComponent(route.paymentId),
    });
  }
  return routeToScreenName(
    pagePath(route.page === "payment" ? "payments" : route.page),
  );
}

function keyKind(key: ApiKey): string {
  if (key.executionCluster === "devnet") return "Devnet execution key";
  return key.mode === "test" ? "Simulation key" : "Live execution key";
}

function whenText(iso: string | null): string {
  return iso ? formatWhen(iso) : "Never";
}

function MerchantWorkspace() {
  const profileRef = useRef<BusinessProfileHandle>(null);
  const route = useRoute();
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
    // Normalize so a page opened as `/account/` still matches the canonical
    // `/account` the history guard compares against.
    currentPathRef.current = normalizePath(window.location.pathname);
  });
  useEffect(() => {
    // Back/forward fire popstate directly, bypassing the click guard. If it
    // leaves the account page with unsaved edits and the owner declines to
    // discard, re-push the account path to cancel the transition.
    const onPopState = () => {
      const wasAccount = currentPathRef.current === pagePath("account");
      const now = normalizePath(window.location.pathname);
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
  const [origin, setOrigin] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One-time secrets (API keys and webhook signing secrets) are revealed once.
  // Held at the workspace level and shown above the routed content so switching
  // pages never discards the only copy the merchant is given.
  const [secretReveal, setSecretReveal] = useState<{
    secret: string;
    label: string;
    kind: "api_key" | "webhook_secret";
  } | null>(null);
  const [keyName, setKeyName] = useState("");
  const search = useSearch();

  const merchantId = data?.merchant.id;
  useEffect(() => {
    if (merchantId) analytics.identify(merchantId, { merchant_id: merchantId });
  }, [merchantId]);

  const screen = !ready
    ? null
    : data
      ? screenFor(route)
      : !authenticated
        ? "/sign-in"
        : account.status === "loading"
          ? null
          : "/setup";
  useEffect(() => {
    if (screen) analytics.screen(screen);
  }, [screen]);

  async function run(action: () => Promise<void>, name?: string) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      trackActionFailed(name ?? "unknown", e);
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
    setSecretReveal({ secret: key.raw, label: "API key", kind: "api_key" });
    analytics.track("merchant_api_key_created", { mode });
    setKeyName("");
    await refresh();
  }
  async function rotate(apiKey: ApiKey) {
    const key = await client.post<{ raw: string }>(
      `keys/${encodeURIComponent(apiKey.id)}/rotate`,
    );
    setSecretReveal({
      secret: key.raw,
      label: "New API key",
      kind: "api_key",
    });
    analytics.track("merchant_api_key_created", {
      mode: apiKey.executionCluster === "devnet" ? "devnet" : apiKey.mode,
      rotated: true,
    });
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

  const errorBanner = error && (
    <p className="banner-error" role="alert">
      {error}
    </p>
  );

  if (!data) {
    return (
      <MerchantSessionBoundary
        ready={ready}
        authenticated={authenticated}
        accountLoading={account.status === "loading"}
      >
        <div className="shell merchant-entry">
          <header className="entry-top">
            <Wordmark />
          </header>
          <main className="entry-panel" aria-busy={busy}>
            <div className="entry-card">
              {!authenticated ? (
                <>
                  <h2>Sign in to your account</h2>
                  <p>
                    Track Payments, manage API keys and set where your USDC
                    lands.
                  </p>
                  <button className="large" disabled={!ready} onClick={login}>
                    Continue with email or passkey
                  </button>
                  <p className="footnote">
                    New to Prydd? The same button creates your account.
                  </p>
                </>
              ) : account.status === "error" ? (
                <ErrorCard
                  title="Your workspace couldn’t load"
                  message={account.error}
                  onRetry={account.retry}
                />
              ) : (
                <>
                  <span className="step-pill">Set up your business</span>
                  <h2>Tell us who is getting paid.</h2>
                  {errorBanner}
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
                        analytics.track("merchant_workspace_created", {});
                      }, "register");
                    }}
                  >
                    <label>
                      Business name
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ada Stores"
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
                        placeholder="https://your-store.com"
                        required
                      />
                      <small>
                        Where the Pay with Prydd button will live. Localhost
                        works for development.
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
                        I understand that Payments settle in USDC on Solana.
                        Prydd does not automatically convert proceeds or send
                        bank payouts. Later conversion uses my chosen provider’s
                        rates and fees.
                      </span>
                    </label>
                    <div className="actions">
                      <button disabled={busy || !identityToken}>
                        Create workspace
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => void run(refresh, "open_existing")}
                      >
                        Open existing
                      </button>
                    </div>
                  </form>
                  <button className="quiet small" onClick={() => void logout()}>
                    Use a different sign-in
                  </button>
                </>
              )}
            </div>
          </main>
          <MerchantEntryStory />
        </div>
      </MerchantSessionBoundary>
    );
  }

  const liveBlocked =
    data.merchant.kybStatus !== "verified" || !data.destination;

  return (
    <MerchantSessionBoundary
      ready={ready}
      authenticated={authenticated}
      accountLoading={account.status === "loading"}
    >
      <div className="shell workspace" data-page={page}>
        <header className="topnav">
          <a
            className="topnav-brand"
            href={pagePath("overview")}
            aria-label="Prydd home"
            onClick={(e) => {
              e.preventDefault();
              go(pagePath("overview"));
            }}
          >
            <Wordmark />
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
          </nav>
          <div className="topnav-actions">
            <span className="network-chip" data-network={data.cluster}>
              <i aria-hidden="true" />
              {data.cluster}
            </span>
            <button
              className={`round-button${page === "account" ? " selected" : ""}`}
              aria-label={`Account for ${data.merchant.displayName}`}
              aria-current={page === "account" ? "page" : undefined}
              title="Account"
              onClick={() => go(pagePath("account"))}
            >
              <Icon name="settings" size={18} />
            </button>
            <button
              className="round-button"
              aria-label="Sign out"
              title="Sign out"
              onClick={() => {
                if (profileRef.current && !profileRef.current.canLeave())
                  return;
                setData(null);
                setSecretReveal(null);
                void logout();
              }}
            >
              <Icon name="signout" size={18} />
            </button>
          </div>
        </header>
        <main className="workspace-main" id="overview" aria-busy={busy}>
          <div className="workspace-inner">
            {errorBanner}
            {secretReveal && (
              <KeyReveal
                key={secretReveal.secret}
                secret={secretReveal.secret}
                label={secretReveal.label}
                onDismiss={() => setSecretReveal(null)}
                onCopied={
                  secretReveal.kind === "api_key"
                    ? () => analytics.track("merchant_api_key_revealed", {})
                    : undefined
                }
              />
            )}
            {page === "overview" ? (
              <OverviewDashboard
                payments={data.payments}
                activeKeys={data.keys.filter((key) => !key.revokedAt).length}
                cluster={data.cluster}
                name={data.merchant.displayName}
                onPayments={() => navigate(pagePath("payments"))}
                onPayment={(id) => navigate(paymentPath(id))}
                onAccount={() => navigate(pagePath("account"))}
                onDevelopers={() => navigate(pagePath("developers"))}
                receivingConnected={Boolean(data.destination)}
                kybStatus={data.merchant.kybStatus}
              />
            ) : page === "payments" ? (
              <PaymentsPanel
                key={search}
                client={client}
                onDevelopers={() => navigate(pagePath("developers"))}
              />
            ) : page === "payment" && route.paymentId ? (
              <PaymentDetail client={client} paymentId={route.paymentId} />
            ) : page === "webhooks" ? (
              <WebhooksPanel
                client={client}
                onSecret={(secret, label) =>
                  setSecretReveal({ secret, label, kind: "webhook_secret" })
                }
                revealActive={secretReveal !== null}
                cluster={data.cluster}
              />
            ) : page === "audit" ? (
              <AuditPanel client={client} />
            ) : page === "account" ? (
              <section className="account-workspace" id="setup">
                <PageHeader title="Account" />
                <ReceivingAccount
                  client={client}
                  destination={data.destination}
                  receivingWallet={data.merchant.receivingWallet}
                  cluster={data.cluster}
                  nairaAvailable={data.nairaSettlementAvailable === true}
                  busy={busy}
                  run={run}
                  onConnected={refresh}
                />
                <section className="settings-section">
                  <header>
                    <h2>Business verification</h2>
                    <p>Required before you create a live key.</p>
                    <StatusChip
                      status={
                        data.merchant.kybStatus === "verified"
                          ? "succeeded"
                          : data.merchant.kybStatus === "rejected"
                            ? "failed"
                            : data.merchant.kybSubmittedAt
                              ? "pending"
                              : "created"
                      }
                    >
                      {data.merchant.kybStatus === "verified"
                        ? "Verified"
                        : data.merchant.kybStatus === "rejected"
                          ? "Not approved"
                          : data.merchant.kybSubmittedAt
                            ? "In review"
                            : "Not started"}
                    </StatusChip>
                  </header>
                  <div className="settings-body">
                    <p className="card-body">
                      Simulation keys work now. Live keys need business
                      verification and a connected receiving account.
                    </p>
                    {data.merchant.kybStatus === "rejected" &&
                      data.merchant.kybReviewNote && (
                        <p className="inline-error" role="status">
                          {data.merchant.kybReviewNote}
                        </p>
                      )}
                    {data.merchant.kybSubmittedAt &&
                      data.merchant.kybStatus === "pending" && (
                        <p className="footnote">
                          Submitted for review on{" "}
                          {whenText(data.merchant.kybSubmittedAt)}.
                        </p>
                      )}
                    {data.merchant.kybStatus !== "verified" && (
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
                            analytics.track("merchant_review_submitted", {});
                          }, "review_submit")
                        }
                      >
                        {data.merchant.kybStatus === "rejected"
                          ? "Resubmit for verification"
                          : data.merchant.kybSubmittedAt
                            ? "Resubmit business details"
                            : "Submit details for verification"}
                      </button>
                    )}
                    {data.cluster === "devnet" && (
                      <p className="footnote">
                        Devnet setup does not represent completed business
                        verification.
                      </p>
                    )}
                  </div>
                </section>
                <BrandSection
                  merchant={data.merchant}
                  onCategory={(category) =>
                    reportFailure("brand_category", async () => {
                      setData(
                        await client.put<Dashboard>("branding", { category }),
                      );
                      analytics.track("merchant_brand_saved", {
                        part: "category",
                      });
                    })
                  }
                  onUpload={(logo) =>
                    reportFailure("brand_logo", async () => {
                      setData(await client.put<Dashboard>("logo", logo));
                      analytics.track("merchant_brand_saved", { part: "logo" });
                    })
                  }
                  onRemove={() =>
                    reportFailure("brand_logo_remove", async () => {
                      setData(await client.delete<Dashboard>("logo"));
                      analytics.track("merchant_brand_saved", {
                        part: "logo_removed",
                      });
                    })
                  }
                />
                <BusinessProfileForm
                  ref={profileRef}
                  key={data.merchant.id}
                  merchant={data.merchant}
                  onSave={(update) =>
                    reportFailure("profile_save", async () => {
                      const next = await client.post<Dashboard>(
                        "profile",
                        update,
                      );
                      setData(next);
                      analytics.track("merchant_profile_saved", {});
                      return next.merchant;
                    })
                  }
                />
              </section>
            ) : (
              <section className="developer-workspace" id="keys">
                <PageHeader
                  eyebrow="Developers"
                  title="API keys"
                  description={`Your server creates Payments with a secret key. Simulation keys never move USDC; live keys settle real USDC on ${data.cluster}.${data.devnetExecutionEnabled ? " Devnet execution keys move test USDC only and are rejected on mainnet." : ""}`}
                />

                <section>
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
                        onClick={() =>
                          void run(() => issue("test"), "api_key_create")
                        }
                      >
                        <Icon name="plus" size={15} />
                        Simulation key
                      </button>
                      {data.cluster !== "devnet" && (
                        <button
                          className="secondary"
                          disabled={
                            busy || secretReveal !== null || liveBlocked
                          }
                          title={
                            liveBlocked
                              ? "Verify your business and connect a receiving account first"
                              : undefined
                          }
                          onClick={() =>
                            void run(() => issue("live"), "api_key_create")
                          }
                        >
                          Live key
                        </button>
                      )}
                      {data.devnetExecutionEnabled && (
                        <button
                          className="secondary"
                          disabled={
                            busy || secretReveal !== null || !data.destination
                          }
                          onClick={() =>
                            void run(() => issue("devnet"), "api_key_create")
                          }
                        >
                          Devnet execution key
                        </button>
                      )}
                    </div>
                  </div>
                  {data.cluster !== "devnet" && liveBlocked && (
                    <p className="footnote spaced">
                      Live keys unlock once your business is verified and a
                      receiving account is connected.{" "}
                      <a
                        className="text-link"
                        href={pagePath("account")}
                        onClick={(e) => {
                          e.preventDefault();
                          go(pagePath("account"));
                        }}
                      >
                        Go to Account
                      </a>
                    </p>
                  )}
                  {secretReveal !== null && (
                    <p className="footnote spaced">
                      Copy and dismiss the secret above before creating,
                      rotating or revoking another key.
                    </p>
                  )}

                  <div className="key-list section-tight">
                    {data.keys.length === 0 && (
                      <div className="empty">
                        <div className="empty-icon">
                          <Icon name="key" />
                        </div>
                        <strong>No API keys yet</strong>
                        <p>
                          Create a simulation key to start your integration. It
                          never moves money.
                        </p>
                      </div>
                    )}
                    {data.keys.map((key) => (
                      <KeyRow
                        key={key.id}
                        apiKey={key}
                        disabled={busy || secretReveal !== null}
                        onRotate={() =>
                          void run(() => rotate(key), "api_key_rotate")
                        }
                        onRevoke={async () => {
                          const revoked = await reportFailure(
                            "api_key_revoke",
                            () =>
                              client.post<{
                                revokedAt: string;
                              }>(`keys/${encodeURIComponent(key.id)}/revoke`),
                          );
                          analytics.track("merchant_api_key_revoked", {});
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
                        }}
                      />
                    ))}
                  </div>
                </section>

                <section className="section">
                  <div className="section-label">
                    <div>
                      <h2>Add Pay with Prydd to your checkout</h2>
                      <p>
                        Your server creates the Payment. The button only opens
                        it.
                      </p>
                    </div>
                  </div>
                  <div className="integrate">
                    <div className="side-stack">
                      <IntegrationSteps />
                      <div className="panel-grey">
                        <h2>Keep it safe</h2>
                        <ul className="checklist spaced">
                          <li>
                            <Icon name="check" size={16} />
                            Keep secret keys on your server, never in browser or
                            app code.
                          </li>
                          <li>
                            <Icon name="check" size={16} />
                            Never commit a key to version control.
                          </li>
                          <li>
                            <Icon name="check" size={16} />
                            Use a separate key for each environment.
                          </li>
                          <li>
                            <Icon name="check" size={16} />
                            Fulfil only after your server confirms the Payment.
                          </li>
                        </ul>
                      </div>
                    </div>
                    <CodeTabs tabs={["react", "script", "server", "confirm"]} />
                  </div>
                </section>
              </section>
            )}
          </div>
          <footer className="workspace-foot">
            <span>Built for business. Settled in USDC.</span>
            <span>Bank payouts are not available in V1.</span>
          </footer>
        </main>
      </div>
    </MerchantSessionBoundary>
  );
}

function KeyRow({
  apiKey: key,
  disabled,
  onRotate,
  onRevoke,
}: {
  apiKey: ApiKey;
  disabled: boolean;
  onRotate: () => void;
  onRevoke: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  // A rotated key keeps working until its grace window closes; show it as
  // expiring, not plainly active, and do not offer to rotate it again (its
  // successor exists).
  const graceUntil = key.rotationGraceUntil
    ? new Date(key.rotationGraceUntil)
    : null;
  const isExpiring =
    !key.revokedAt && graceUntil !== null && graceUntil.getTime() > Date.now();
  return (
    <article className="key-row" data-revoked={Boolean(key.revokedAt)}>
      <div>
        <h3>
          {key.name ? key.name : keyKind(key)}
          <StatusChip
            status={
              key.revokedAt ? "canceled" : isExpiring ? "pending" : "succeeded"
            }
          >
            {key.revokedAt ? "Revoked" : isExpiring ? "Expiring" : "Active"}
          </StatusChip>
        </h3>
        <div className="key-meta">
          {key.name && <span>{keyKind(key)}</span>}
          <code>{key.fingerprint}</code>
          <span>Created {whenText(key.createdAt)}</span>
          <span>Last used {whenText(key.lastUsedAt)}</span>
          {key.rotatedFromId && <span>Rotated from a prior key</span>}
          {isExpiring && graceUntil && (
            <span>
              Replaced; valid until {whenText(graceUntil.toISOString())}
            </span>
          )}
        </div>
      </div>
      {!key.revokedAt && !confirming && (
        <div className="key-actions">
          {!isExpiring && (
            <button
              className="secondary small"
              disabled={disabled}
              onClick={onRotate}
            >
              Rotate
            </button>
          )}
          <RevokeKey
            fingerprint={key.fingerprint}
            disabled={disabled}
            onRevoke={onRevoke}
            confirming={false}
            onConfirmingChange={setConfirming}
          />
        </div>
      )}
      {!key.revokedAt && confirming && (
        <RevokeKey
          fingerprint={key.fingerprint}
          onRevoke={onRevoke}
          confirming
          onConfirmingChange={setConfirming}
        />
      )}
    </article>
  );
}

const appId = import.meta.env.VITE_PRIVY_APP_ID;
createRoot(document.getElementById("root")!).render(
  appId ? (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: "light",
          accentColor: "#0a0a0a",
          logo: "/favicon.svg",
        },
        loginMethods: ["email", "passkey"],
        embeddedWallets: { solana: { createOnLogin: "users-without-wallets" } },
      }}
    >
      <DashboardApp />
    </PrivyProvider>
  ) : (
    <main className="workspace-loading">
      <p>Configure VITE_PRIVY_APP_ID to start the Merchant dashboard.</p>
    </main>
  ),
);
