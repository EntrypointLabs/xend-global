export type ReviewState = "full" | "empty" | "new" | "signedout" | "error";

export function reviewState(): ReviewState {
  const value = new URLSearchParams(window.location.search).get("state");
  return (
    (["full", "empty", "new", "signedout", "error"] as const).find(
      (s) => s === value,
    ) ?? "full"
  );
}

const now = Date.now();

const SAMPLE_LOGO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#e8552d"/><path d="M18 44 32 18l14 26h-7l-7-13-7 13z" fill="#fff"/></svg>',
)}`;

// Brand edits made in review mode, kept for the page's lifetime so the Account
// page reflects an upload, removal or category change.
const brand: {
  logoUrl?: string | null;
  logoSource?: "upload" | "site" | null;
  category?: string;
} = {};
const iso = (hoursAgo: number) =>
  new Date(now - hoursAgo * 3_600_000).toISOString();

const amounts = [
  42_170000, 18_500000, 63_000000, 9_990000, 27_250000, 120_000000, 54_400000,
  31_800000, 76_150000, 12_000000,
];
const statuses = [
  "succeeded",
  "succeeded",
  "created",
  "succeeded",
  "failed",
  "succeeded",
  "settling",
  "succeeded",
  "expired",
  "succeeded",
];

const payments = amounts.map((amount, i) => ({
  id: `pi_${(9_400_000 + i * 7919).toString(36)}${"k2mz8q".slice(i % 3)}`,
  status: statuses[i]!,
  amountRaw: String(amount),
  usdcSettlementRaw: String(amount),
  displayCurrency: i % 3 === 0 ? "NGN" : "USD",
  displayAmountMinor:
    i % 3 === 0 ? String((amount / 10_000) * 1_550) : String(amount / 10_000),
  merchantReference: i % 2 ? `order-${1042 + i}` : null,
  mode: i === 4 ? "test" : "live",
  createdAt: iso(i * 9 + 1),
}));

function dashboard(empty: boolean) {
  return {
    cluster: "mainnet",
    devnetExecutionEnabled: false,
    nairaSettlementAvailable: false,
    merchant: {
      id: "m_review",
      displayName: "Ada Stores",
      signInEmail: "owner@adastores.ng",
      profileVersion: 3,
      businessProfile: empty
        ? {}
        : {
            legalName: "Ada Stores Limited",
            contactName: "Adaeze Okafor",
            contactEmail: "hello@adastores.ng",
            phone: "+234 801 234 5678",
            website: "https://adastores.ng",
            addressLine1: "12 Admiralty Way",
            city: "Lekki",
            region: "Lagos",
            country: "Nigeria",
          },
      kybStatus: empty ? "pending" : "verified",
      kybSubmittedAt: empty ? null : iso(400),
      kybReviewNote: null,
      receivingWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      logoUrl: empty ? "/review-missing-logo.png" : SAMPLE_LOGO,
      logoSource: empty ? ("site" as const) : ("upload" as const),
      category: empty ? "food_drink" : "shopping",
      ...brand,
    },
    destination: empty
      ? null
      : { address: "9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT" },
    keys: empty
      ? []
      : [
          {
            id: "k1",
            name: "Storefront",
            fingerprint: "pk_live…7Hq2",
            mode: "live",
            executionCluster: "mainnet",
            rotatedFromId: null,
            rotationGraceUntil: null,
            lastUsedAt: iso(2),
            revokedAt: null,
            createdAt: iso(300),
          },
          {
            id: "k2",
            name: null,
            fingerprint: "pk_test…a91c",
            mode: "test",
            executionCluster: null,
            rotatedFromId: null,
            rotationGraceUntil: null,
            lastUsedAt: iso(50),
            revokedAt: null,
            createdAt: iso(500),
          },
          {
            id: "k3",
            name: "Old staging",
            fingerprint: "pk_test…0f3e",
            mode: "test",
            executionCluster: null,
            rotatedFromId: null,
            rotationGraceUntil: null,
            lastUsedAt: null,
            revokedAt: iso(200),
            createdAt: iso(900),
          },
        ],
    payments: empty ? [] : payments,
  };
}

function route(
  path: string,
  empty: boolean,
  method: string,
  body: unknown,
): unknown {
  if (path === "branding" && method === "PUT")
    Object.assign(brand, { category: (body as { category: string }).category });
  if (path === "logo" && method === "PUT") {
    const logo = body as { contentType: string; dataBase64: string };
    Object.assign(brand, {
      logoUrl: `data:${logo.contentType};base64,${logo.dataBase64}`,
      logoSource: "upload",
    });
  }
  if (path === "logo" && method === "DELETE")
    Object.assign(brand, {
      logoUrl: "/review-missing-logo.png",
      logoSource: null,
    });
  if (path === "me" || path === "branding" || path === "logo")
    return dashboard(empty);
  if (path.startsWith("payments/"))
    return {
      ...payments[0],
      pricingCurrency: payments[0]!.displayCurrency,
      fxRate: null,
      fxSource: null,
      fxQuotedAt: null,
      metadata: { sku: "TSHIRT-L", channel: "web" },
      confirmationReference:
        "5Hh9xQ2mVt8cR7wK3pLnZ4yB6dF1sJ9gA2eT5uW8oN3vX7rM4kP",
      failureReason: null,
      expiresAt: iso(0.5),
      authorizedAt: iso(0.95),
      settledAt: iso(0.9),
      webhookDeliveries: [],
    };
  if (path.startsWith("payments"))
    return {
      payments: empty ? [] : payments,
      nextCursor: empty ? null : "more",
    };
  if (path.includes("/deliveries")) return { deliveries: [], nextCursor: null };
  if (path.startsWith("webhooks"))
    return {
      endpoints: empty
        ? []
        : [
            {
              id: "wh1",
              url: "https://adastores.ng/api/webhooks/prydd",
              mode: "live",
              enabled: true,
              eventTypes: null,
              secondaryExpiresAt: null,
              createdAt: iso(120),
            },
          ],
    };
  if (path.startsWith("audit"))
    return {
      entries: empty
        ? []
        : [
            {
              id: "a1",
              action: "api_key.issue",
              actor: "Owner",
              target: "k1",
              metadata: { mode: "live", fingerprint: "pk_live…7Hq2" },
              at: iso(3),
            },
            {
              id: "a2",
              action: "webhook.create",
              actor: "Owner",
              target: "wh1",
              metadata: {
                url: "https://adastores.ng/api/webhooks/prydd",
                mode: "live",
              },
              at: iso(120),
            },
            {
              id: "a3",
              action: "kyb.submit",
              actor: "Owner",
              target: "m_review",
              metadata: null,
              at: iso(400),
            },
            {
              id: "a4",
              action: "profile.update",
              actor: "Owner",
              target: "m_review",
              metadata: { version: "3" },
              at: iso(410),
            },
            {
              id: "a5",
              action: "destination.provision",
              actor: "Owner",
              target: "m_review",
              metadata: null,
              at: iso(420),
            },
          ],
      nextCursor: null,
    };
  return {};
}

export function installReviewFixtures() {
  const state = reviewState();
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const match = url.match(/merchant-portal\/(.+)$/);
    if (!match) return real(input, init);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const path = match[1]!;
    if (state === "new" && path === "me")
      return new Response("{}", { status: 404 });
    if (state === "error" && path !== "me")
      return new Response(
        JSON.stringify({
          message: "The server could not be reached. Check your connection.",
        }),
        { status: 503 },
      );
    const method = init?.method ?? "GET";
    const body: unknown =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    return new Response(
      JSON.stringify(route(path, state === "empty", method, body)),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };
}
