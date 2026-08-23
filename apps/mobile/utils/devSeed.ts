import type {
  BalancesResponse,
  StagedChange,
  ListSessionsResponse,
  PrepareTransferResponse,
  RecoveryKey,
  TransferListResponse,
  WalletResponse,
} from "@/utils/apiClient";
import { getUsdcMint } from "@/utils/cluster";

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

const WALLET = "GkP9xL7mQwR2sT4vB6nH8jC3dF5aZ1yU2eW4rK6tN9pM";

export const SEED_USER = {
  id: "demo-consumer-0001",
  email: "amara@xend.global",
  walletAddress: WALLET,
  smart_account_address: WALLET,
};

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
  });

  if (state === "empty") return [];
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
