import type { SwapTokenCategory, SwapTokenListing } from "@/utils/swap";
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
import { demoRampActivity } from "@/utils/devSeedFiat";

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
  email: "amara@prydd.co",
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

const siteIcon = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

const MISSING_LOGO = "https://prydd.co/__seed__/no-such-logo.png";

const hoursAgo = (h: number) =>
  new Date(Date.now() - h * 3_600_000).toISOString();

export function seedWallet(): WalletResponse {
  return { walletAddress: WALLET, provider: "privy" };
}

/**
 * `EXPO_PUBLIC_SEED_BALANCE=empty` seeds an Account that holds nothing, which
 * is the state every new Consumer starts in and the hardest one to reach with
 * a funded fixture. `usdc` seeds cash and nothing else, the state of a
 * Consumer who has added money but bought no asset.
 */
export function seedBalances(): BalancesResponse {
  if (process.env.EXPO_PUBLIC_SEED_BALANCE === "empty") {
    return { walletAddress: WALLET, tokens: [], fetchedAtSlot: 312_004_918 };
  }
  if (process.env.EXPO_PUBLIC_SEED_BALANCE === "usdc") {
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
  return {
    walletAddress: WALLET,
    tokens: [
      {
        mint: usdcMint(),
        amountRaw: "2847500000",
        decimals: 6,
        symbol: "USDC",
      },
      {
        mint: "So11111111111111111111111111111111111111112",
        amountRaw: "3250000000",
        decimals: 9,
        symbol: "SOL",
        name: "Solana",
        usdValue: 512.4,
        usdPrice: 157.66,
        priceChange24h: 5.1,
      },
      {
        mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
        amountRaw: "310000000",
        decimals: 6,
        symbol: "JUP",
        name: "Jupiter",
        iconUrl: "https://static.jup.ag/jup/icon.png",
        usdValue: 230.8,
        usdPrice: 0.7445,
        priceChange24h: -0.9,
      },
    ],
    fetchedAtSlot: 312_004_918,
  };
}

/**
 * The backend freezes what each transfer was worth when it indexes it, and the
 * balance chart and the day's change are both drawn from that. Every seeded
 * transfer is USDC, so its value is its face value.
 */
function withFrozenValue<T extends { amountRaw: string }>(row: T) {
  return { ...row, usdValue: (Number(row.amountRaw) / 1e6).toFixed(2) };
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
        id: "evt-3",
        kind: "recovery_key_removed",
        subject: "Fq9z...7Kd2",
        previousSubject: null,
        signature: "5pWq2Xr8tYb3nM6kJ9hG4fD1sA7zC2vB5nM8kL3jH6gF",
        occurredAt: hoursAgo(7),
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
    transfers: (
      [
        {
          id: "t-ramp-in",
          direction: "RECEIVE",
          mint,
          amountRaw: "6904024",
          fromAddress: "Pay9rWb2CqKq4xYv8tN3dLmS7eHfUa1o5ZgXjQuAb1",
          toAddress: WALLET,
          status: "CONFIRMED",
          signature: sig("r1"),
          memo: null,
          kind: "transfer",
          merchantName: null,
          ramp: demoRampActivity.deposit,
          createdAt: hoursAgo(0.4),
          confirmedAt: hoursAgo(0.4),
        },
        {
          id: "t-ramp-kuda",
          direction: "SEND",
          mint,
          amountRaw: "3512817",
          fromAddress: WALLET,
          toAddress: "Dep3kQe7VbN2mXc9pLs4dRw6TzYu8oJi1gHa5Kf8Ab2",
          status: "CONFIRMED",
          signature: sig("r2"),
          memo: null,
          kind: "transfer",
          merchantName: null,
          ramp: demoRampActivity.kudaSend,
          createdAt: hoursAgo(0.2),
          confirmedAt: hoursAgo(0.2),
        },
        {
          id: "t-ramp-refund",
          direction: "RECEIVE",
          mint,
          amountRaw: "1187458",
          fromAddress: "Mp6SdLdTHkpomAPp61jCd4NBusdT7XW1Epo2rzGwhK8",
          toAddress: WALLET,
          status: "CONFIRMED",
          signature: sig("r6"),
          memo: null,
          kind: "transfer",
          merchantName: null,
          ramp: { ...demoRampActivity.moniepointSend, refund: true },
          createdAt: hoursAgo(0.1),
          confirmedAt: hoursAgo(0.1),
        },
        {
          id: "t-ramp-legacy",
          direction: "SEND",
          mint,
          amountRaw: "1398601",
          fromAddress: WALLET,
          toAddress: "Leg3kQe7VbN2mXc9pLs4dRw6TzYu8oJi1gHa5Kf8Ab3",
          status: "CONFIRMED",
          signature: sig("r4"),
          memo: null,
          kind: "transfer",
          merchantName: null,
          ramp: demoRampActivity.legacySend,
          createdAt: hoursAgo(1),
          confirmedAt: hoursAgo(1),
        },
        {
          id: "t-ramp-moniepoint",
          direction: "SEND",
          mint,
          amountRaw: "1210226",
          fromAddress: WALLET,
          toAddress: "Mp6SdLdTHkpomAPp61jCd4NBusdT7XW1Epo2rzGwhK8",
          status: "CONFIRMED",
          signature: sig("r7"),
          memo: null,
          kind: "transfer",
          merchantName: null,
          ramp: demoRampActivity.moniepointSend,
          createdAt: hoursAgo(2),
          confirmedAt: hoursAgo(2),
        },
        {
          id: "t-ramp-gtb",
          direction: "SEND",
          mint,
          amountRaw: "30100000",
          fromAddress: WALLET,
          toAddress: "Gt8b2Xr8tYb3nM6kJ9hG4fD1sA7zC2vB5nM8kL3jH6gF",
          status: "CONFIRMED",
          signature: sig("r3"),
          memo: null,
          kind: "transfer",
          merchantName: null,
          ramp: demoRampActivity.gtbSend,
          createdAt: hoursAgo(3),
          confirmedAt: hoursAgo(3),
        },
        {
          id: "t-00",
          direction: "SEND",
          mint,
          amountRaw: "8000000",
          fromAddress: WALLET,
          toAddress: other,
          status: "CONFIRMED",
          signature: sig("p0"),
          memo: null,
          kind: "payment",
          merchantName: "Prydd Shop",
          // Answers 404, the way a Merchant with no logo and no site icon does.
          merchantLogoUrl: MISSING_LOGO,
          merchantCategory: "shopping",
          createdAt: hoursAgo(1),
          confirmedAt: hoursAgo(1),
        },
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
          merchantLogoUrl: siteIcon("bluebottlecoffee.com"),
          merchantCategory: "food_drink",
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
          merchantLogoUrl: null,
          merchantCategory: "groceries",
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
          merchantLogoUrl: siteIcon("uber.com"),
          merchantCategory: "transport",
          createdAt: hoursAgo(146),
          confirmedAt: hoursAgo(146),
        },
      ] satisfies TransferListResponse["transfers"]
    ).map(withFrozenValue),
  };
}

export function seedSessions(): ListSessionsResponse {
  return {
    sessions: [
      {
        id: "s-00",
        merchantDisplayName: "Prydd Shop",
        merchantLogoUrl: MISSING_LOGO,
        merchantCategory: "shopping",
        createdAt: hoursAgo(48),
        lastUsedAt: hoursAgo(1),
        expiresAt: hoursAgo(-660),
      },
      {
        id: "s-01",
        merchantDisplayName: "Blue Bottle Coffee",
        merchantLogoUrl: siteIcon("bluebottlecoffee.com"),
        merchantCategory: "food_drink",
        createdAt: hoursAgo(240),
        lastUsedAt: hoursAgo(6),
        expiresAt: hoursAgo(-480),
      },
      {
        id: "s-02",
        merchantDisplayName: "Whole Foods Market",
        merchantLogoUrl: null,
        merchantCategory: "groceries",
        createdAt: hoursAgo(400),
        lastUsedAt: hoursAgo(74),
        expiresAt: hoursAgo(-320),
      },
      {
        id: "s-03",
        merchantDisplayName: "Spotify",
        merchantLogoUrl: siteIcon("spotify.com"),
        merchantCategory: "entertainment",
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
    channelValue: "amara@prydd.co",
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

const ICONS = "https://static.datapi.jup.ag/token-icons";

/** A few of the assets Swap offers, enough to show every shelf populated. */
export function seedSwapTokens(
  query: string,
  category: SwapTokenCategory | null
): SwapTokenListing[] {
  const wanted = query.trim().toLowerCase();
  const token = (
    mint: string,
    symbol: string,
    name: string,
    decimals: number,
    icon: string,
    shelf: SwapTokenCategory,
    usdPrice: number
  ): SwapTokenListing => ({
    mint,
    symbol,
    name,
    decimals,
    iconUrl: `${ICONS}/${icon}.webp`,
    category: shelf,
    usdPrice,
  });
  const all = [
    token(
      "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      "USDT",
      "USDT",
      6,
      "36574a5ee2cd469e059d070180985e59fbd57c82a54ea95763fab39973174100",
      "stable",
      1
    ),
    token(
      "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
      "USDG",
      "Global Dollar",
      6,
      "234d4d10c9356ac40b3f8a4dac8cb363beec75ba2f9c8a18157742494193b4d7",
      "stable",
      0.9997
    ),
    token(
      "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
      "WBTC",
      "Wrapped BTC (Portal)",
      8,
      "010fb6db6c343cd0f90214ab1770278012d0c58a091d1f64715343817dbfb27e",
      "crypto",
      86282.66
    ),
    token(
      "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
      "RAY",
      "Raydium",
      6,
      "e3a3487516776ef5cd3166a0861525d053845b5aa0cf27442a56ca65e673b265",
      "crypto",
      1.84
    ),
    token(
      "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
      "NVDAx",
      "NVIDIA xStock",
      8,
      "5550a81a36c9cce2af5d8b738bcf665c7b4da250a4652dd025107a5d6f0b9458",
      "stocks",
      165
    ),
    token(
      "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
      "SPYx",
      "SP500 xStock",
      8,
      "4d04cfdd8396f0c9274d49f135a458b7d4726cc098e3fc69bb3b4124eb24a2f2",
      "stocks",
      719.87
    ),
    token(
      "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      "Bonk",
      "Bonk",
      5,
      "7461f749f396872bdba0559323970190e22056d87f08792ce597c00f3c23a6d0",
      "meme",
      0.00002134
    ),
    token(
      "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN",
      "TRUMP",
      "OFFICIAL TRUMP",
      6,
      "e142362a7cf11f8765782343c1de0087c7c046c5a0b0a3ad2c301719858ff769",
      "meme",
      0.9213
    ),
  ];
  if (wanted) {
    return all.filter(
      (listed) =>
        listed.name.toLowerCase().includes(wanted) ||
        listed.symbol.toLowerCase().includes(wanted)
    );
  }
  return all.filter((listed) =>
    category
      ? listed.category === category
      : listed.category === "crypto" || listed.category === "stable"
  );
}
