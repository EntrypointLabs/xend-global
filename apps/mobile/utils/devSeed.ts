import type {
  BalancesResponse,
  ListSessionsResponse,
  PrepareTransferResponse,
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
