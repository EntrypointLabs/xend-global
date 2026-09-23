import type {
  AccountResponse,
  ProvisioningStep,
  BalancesResponse,
  StagedChange,
  ListSessionsResponse,
  PrepareTransferResponse,
  RecoveryKey,
  TransferListResponse,
  WalletResponse,
} from "@/utils/apiClient";
import { getUsdcMint } from "@/utils/cluster";
import type { z } from "zod";
import type { BankAccountsSchema } from "@/utils/bank-accounts";
import type { ObservedBalancesSchema } from "@/utils/observed-balances";
import type { NairaTransfersSchema } from "@/utils/naira-transfers";
import type { FiatQuoteSchema, FiatRouteSchema } from "@/utils/fiat";

/**
 * Demo seed for screenshots and offline UI work. When enabled, `AuthContext`
 * enters an authenticated state without a Privy/backend round-trip and
 * `apiClient` read methods return the fixtures below, so the money screens
 * render with realistic data on a fresh simulator (where the passkey ceremony
 * can't complete). Strictly dev-gated — `__DEV__` compiles it out of release
 * builds, and it stays inert unless `EXPO_PUBLIC_SEED_DEMO=true`.
 */
export const SEED_DEMO =
  __DEV__ && process.env.EXPO_PUBLIC_SEED_DEMO === "true";

/**
 * Which session tier the seeded session pretends to hold. `entry` renders the
 * looking-not-spending state, which is otherwise unreachable on a simulator
 * because opening a real entry session needs a mailed code.
 */
export const SEED_TIER: "full" | "entry" =
  process.env.EXPO_PUBLIC_SEED_TIER === "entry" ? "entry" : "full";

const WALLET = "GkP9xL7mQwR2sT4vB6nH8jC3dF5aZ1yU2eW4rK6tN9pM";

export const SEED_USER = {
  id: "demo-consumer-0001",
  email: "amara@xend.global",
  walletAddress: WALLET,
  smart_account_address: WALLET,
};

const demoNow = () => new Date().toISOString();

export function seedBankAccounts(): z.infer<typeof BankAccountsSchema> {
  const now = demoNow();
  return {
    provider: "paga",
    environment: "sandbox",
    available: true,
    reconciliationAvailable: true,
    accounts: [
      {
        id: "demo-naira-account",
        provider: "paga",
        environment: "sandbox",
        currency: "NGN",
        status: "active",
        account: {
          provider: "paga",
          reference: "demo-naira-account",
          accountNumber: "0123456789",
          accountName: "Amara Okafor",
          bankName: "Paga",
          currency: "NGN",
          custody: "pooled",
        },
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

export function seedObservedFiatBalances(): z.infer<
  typeof ObservedBalancesSchema
> {
  const now = demoNow();
  return {
    mode: "observed",
    bankEnvironment: "sandbox",
    network: "devnet",
    holdings: [
      {
        currency: "NGN",
        decimals: 2,
        status: "available",
        amountMinor: "38542050",
        observedAt: now,
        reason: null,
      },
      {
        currency: "USDC",
        decimals: 6,
        status: "available",
        amountMinor: "2847500000",
        observedAt: now,
        reason: null,
      },
    ],
    total: {
      currency: "USD",
      amountMinor: "310445",
      estimate: true,
      asOf: now,
    },
    valuationReason: null,
  };
}

export function seedNairaTransfers(): z.infer<typeof NairaTransfersSchema> {
  const now = demoNow();
  return {
    environment: "sandbox",
    available: true,
    scope: "xend_paga_accounts",
    transfers: [
      {
        id: "c0a8012e-4b8b-4d44-9e61-f5a7ba013194",
        provider: "paga",
        environment: "sandbox",
        currency: "NGN",
        status: "completed",
        sourceAccountNumber: "0123456789",
        destination: {
          accountNumber: "0987654321",
          accountName: "Tobi Adeyemi",
        },
        amountMinor: "2500000",
        feeMinor: null,
        narration: "Xend transfer",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        createdAt: new Date(Date.now() - 3_600_000).toISOString(),
        updatedAt: now,
        providerReference: "demo-paga-transfer",
      },
    ],
  };
}

export function seedFiatRoutes(): z.infer<typeof FiatRouteSchema>[] {
  const route = (
    direction: "receive" | "send"
  ): z.infer<typeof FiatRouteSchema> => ({
    id: `fonbnk:${direction}`,
    provider: "fonbnk",
    direction,
    environment: "sandbox",
    sourceCurrency: direction === "receive" ? "NGN" : "USDC",
    destinationCurrency: direction === "receive" ? "USDC" : "NGN",
    network: "solana",
    quoteAvailable: true,
    orderAvailable: false,
    accountKinds: [],
    holdsFiat: false,
    thirdPartyPayments: "unknown",
  });
  return [route("receive"), route("send")];
}

export function seedFiatQuote(
  routeId: string,
  amountMinor: string
): z.infer<typeof FiatQuoteSchema> {
  const route = seedFiatRoutes().find((item) => item.id === routeId);
  if (!route) throw new Error("Demo route is unavailable");
  const receive = route.direction === "receive";
  const credit = receive
    ? ((BigInt(amountMinor) * 1_000_000n) / 150_000n).toString()
    : ((BigInt(amountMinor) * 150_000n) / 1_000_000n).toString();
  return {
    id: "demo-fiat-quote",
    route,
    reference: "demo-provider-quote",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    debit: {
      currency: route.sourceCurrency,
      amountMinor,
      decimals: receive ? 2 : 6,
    },
    credit: {
      currency: route.destinationCurrency,
      amountMinor: credit,
      decimals: receive ? 6 : 2,
    },
    fees: [],
    fields: [],
    paymentStep: "manual_transfer",
  };
}

// The headline total keys off this mint (see utils/balances.ts), so the demo
// balance must use the same mint the app is configured for. Resolved through
// the cluster helper rather than read raw, so the seed cannot disagree with the
// rest of the app about which mint is USDC.
function usdcMint(): string {
  return getUsdcMint();
}

const hoursAgo = (h: number) =>
  new Date(Date.now() - h * 3_600_000).toISOString();

export function seedWallet(): WalletResponse {
  return { walletAddress: WALLET, provider: "privy" };
}

export function seedBalances(): BalancesResponse {
  return {
    walletAddress: WALLET,
    tokens: [
      {
        mint: usdcMint(),
        amountRaw: "2847500000",
        decimals: 6,
        symbol: "USDC",
      },
    ],
    fetchedAtSlot: 312_004_918,
  };
}

export function seedTransfers(): TransferListResponse {
  const mint = usdcMint();
  const other = "3nF8kQ2wR5tY7uP1sX4vB6mH9jC0dG2aE5oL8iK3nQ4z";
  const sig = (s: string) =>
    `${s}dEmO5xQ2wR7tY9uP1sX4vB6mH8jC3dF5aZ1yU2eW4rK6tN`;

  return {
    events: [
      {
        id: "evt-1",
        kind: "recovery_key_added",
        subject: "So1111...111112",
        previousSubject: null,
        signature: "3ouU7Kq9vXbN2mRt5wYzA8cD1eF4gH6jK9lM2nP5qR8s",
        occurredAt: hoursAgo(5),
      },
      {
        id: "evt-2",
        kind: "wallet_renamed",
        subject: "Gift",
        previousSubject: "Wallet",
        signature: null,
        occurredAt: hoursAgo(40),
      },
    ],
    nextCursor: null,
    transfers: [
      {
        id: "t-01",
        direction: "RECEIVE",
        mint,
        amountRaw: "250000000",
        fromAddress: other,
        toAddress: WALLET,
        status: "CONFIRMED",
        signature: sig("a1"),
        memo: "Rent split",
        kind: "transfer",
        merchantName: null,
        createdAt: hoursAgo(2),
        confirmedAt: hoursAgo(2),
      },
      {
        id: "t-02",
        direction: "SEND",
        mint,
        amountRaw: "18750000",
        fromAddress: WALLET,
        toAddress: other,
        status: "CONFIRMED",
        signature: sig("b2"),
        memo: null,
        kind: "payment",
        merchantName: "Blue Bottle Coffee",
        createdAt: hoursAgo(6),
        confirmedAt: hoursAgo(6),
      },
      {
        id: "t-03",
        direction: "SEND",
        mint,
        amountRaw: "120000000",
        fromAddress: WALLET,
        toAddress: other,
        status: "CONFIRMED",
        signature: sig("c3"),
        memo: "For groceries",
        kind: "transfer",
        merchantName: null,
        createdAt: hoursAgo(26),
        confirmedAt: hoursAgo(26),
      },
      {
        id: "t-04",
        direction: "RECEIVE",
        mint,
        amountRaw: "1500000000",
        fromAddress: other,
        toAddress: WALLET,
        status: "CONFIRMED",
        signature: sig("d4"),
        memo: "Salary",
        kind: "transfer",
        merchantName: null,
        createdAt: hoursAgo(50),
        confirmedAt: hoursAgo(50),
      },
      {
        id: "t-05",
        direction: "SEND",
        mint,
        amountRaw: "64200000",
        fromAddress: WALLET,
        toAddress: other,
        status: "CONFIRMED",
        signature: sig("e5"),
        memo: null,
        kind: "payment",
        merchantName: "Whole Foods Market",
        createdAt: hoursAgo(74),
        confirmedAt: hoursAgo(74),
      },
      {
        id: "t-06",
        direction: "SEND",
        mint,
        amountRaw: "75000000",
        fromAddress: WALLET,
        toAddress: other,
        status: "CONFIRMED",
        signature: sig("f6"),
        memo: "Split dinner",
        kind: "transfer",
        merchantName: null,
        createdAt: hoursAgo(98),
        confirmedAt: hoursAgo(98),
      },
      {
        id: "t-07",
        direction: "RECEIVE",
        mint,
        amountRaw: "300000000",
        fromAddress: other,
        toAddress: WALLET,
        status: "CONFIRMED",
        signature: sig("g7"),
        memo: "Freelance invoice",
        kind: "transfer",
        merchantName: null,
        createdAt: hoursAgo(122),
        confirmedAt: hoursAgo(122),
      },
      {
        id: "t-08",
        direction: "SEND",
        mint,
        amountRaw: "42000000",
        fromAddress: WALLET,
        toAddress: other,
        status: "CONFIRMED",
        signature: sig("h8"),
        memo: null,
        kind: "payment",
        merchantName: "Uber",
        createdAt: hoursAgo(146),
        confirmedAt: hoursAgo(146),
      },
    ],
  };
}

export function seedSessions(): ListSessionsResponse {
  return {
    sessions: [
      {
        id: "s-01",
        merchantDisplayName: "Blue Bottle Coffee",
        createdAt: hoursAgo(240),
        lastUsedAt: hoursAgo(6),
        expiresAt: hoursAgo(-480),
      },
      {
        id: "s-02",
        merchantDisplayName: "Whole Foods Market",
        createdAt: hoursAgo(400),
        lastUsedAt: hoursAgo(74),
        expiresAt: hoursAgo(-320),
      },
      {
        id: "s-03",
        merchantDisplayName: "Spotify",
        createdAt: hoursAgo(720),
        lastUsedAt: hoursAgo(30),
        expiresAt: hoursAgo(-600),
      },
    ],
  };
}

export function seedPrepareTransfer(): PrepareTransferResponse {
  return {
    intentId: "demo-intent-0001",
    unsignedTxBase64: "AA==",
    feeLamports: 5000,
    expiresAt: hoursAgo(-1),
  };
}

/**
 * Recovery keys for the demo seed.
 *
 * `EXPO_PUBLIC_SEED_RECOVERY` picks the state, because the interesting ones are
 * the in-flight ones and those cannot be reached on a simulator: staging a key
 * needs two on-device signatures and then a day of waiting.
 *
 * - `one`       a single email key, which is every real Account today
 * - `pending`   a second key staged and still waiting on the chain
 * - `removing`  a key on its way out
 * - `rotating`  the contact address being changed: old key out, new key in
 * - `full`      three keys, so the add button is at capacity
 * - `empty`     no keys, which the backend forbids but the screen must survive
 */
export function seedRecoveryKeys(): RecoveryKey[] {
  const state = process.env.EXPO_PUBLIC_SEED_RECOVERY ?? "one";

  const email: RecoveryKey = {
    id: "rk-01",
    address: WALLET,
    channel: "email",
    channelValue: "amara@xend.global",
    createdAt: new Date(Date.now() - 86_400_000 * 30).toISOString(),
    status: "active",
    removable: false,
    isContactAddress: true,
  };
  const wallet = (
    id: string,
    status: RecoveryKey["status"],
    removable: boolean
  ): RecoveryKey => ({
    id,
    address: WALLET,
    channel: "external_wallet",
    channelValue: "So11111111111111111111111111111111111111112",
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    status,
    removable,
    isContactAddress: false,
  });

  if (state === "empty") return [];
  if (state === "rotating") {
    return [
      { ...email, status: "pending_remove" },
      {
        ...email,
        id: "rk-02",
        channelValue: "amara@proton.me",
        createdAt: new Date().toISOString(),
        status: "pending_add",
        isContactAddress: false,
      },
    ];
  }
  if (state === "pending") {
    return [
      { ...email, removable: false },
      wallet("rk-02", "pending_add", false),
    ];
  }
  if (state === "removing") {
    return [
      { ...email, removable: true },
      wallet("rk-02", "pending_remove", false),
    ];
  }
  if (state === "full") {
    return [
      { ...email, removable: true },
      wallet("rk-02", "active", true),
      wallet("rk-03", "active", true),
    ];
  }
  return [email];
}

/**
 * A staged settings change for the demo seed.
 *
 * `EXPO_PUBLIC_SEED_CHANGE` picks who started it: `self` is the Consumer's own
 * key change, which the home banner carries quietly, and `stranger` is the one
 * that interrupts. Neither is reachable on a simulator otherwise, because
 * staging a change needs two on-device signatures.
 */
export function seedPendingChange(): StagedChange | null {
  const state = process.env.EXPO_PUBLIC_SEED_CHANGE;
  if (state !== "self" && state !== "stranger") return null;

  return {
    transactionIndex: "2",
    status: "Approved",
    approvals: [],
    executableAt: new Date(Date.now() + 23.5 * 3600 * 1000).toISOString(),
    selfInitiated: state === "self",
  };
}

/**
 * The Account behind the seeded session. Without it `/account/me` is the one
 * read that still leaves the device on a fresh simulator, and a dead backend
 * answers 404, which the error banner shows over every seeded screen.
 */
export function seedAccount(): AccountResponse {
  return {
    address: WALLET,
    signers: {
      primary: "5qT2wR7tY9uP1sX4vB6mH8jC3dF5aZ1yU2eW4rK6tN9p",
      approval: "7uP1sX4vB6mH8jC3dF5aZ1yU2eW4rK6tN9pM5qT2wR7t",
    },
    approvalSubOrgId: "suborg-demo-0001",
    pendingApprovalSigner: null,
    pendingPrimarySigner: null,
    deviceKey: "9jC3dF5aZ1yU2eW4rK6tN9pM5qT2wR7tY9uP1sX4vB6m",
    spendingLimit: {
      mint: usdcMint(),
      maxPerUse: "500000000",
      maxPerPeriod: "1000000000",
      remainingInPeriod: "742500000",
      period: "Daily",
    },
  };
}

/**
 * The seeded Account is already provisioned, so provisioning has nothing left
 * to hand back. Without this the setup poll is the last read that still leaves
 * the device.
 */
export function seedProvisioningStep(): ProvisioningStep {
  return { done: true, needsApprovalSignature: false };
}
