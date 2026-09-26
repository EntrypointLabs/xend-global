import type { z } from "zod";
import type {
  BankAccountInput,
  BankAccountRecordSchema,
  BankAccountsSchema,
} from "@/utils/bank-accounts";
import type { ObservedBalancesSchema } from "@/utils/observed-balances";
import type {
  NairaTransfer,
  NairaTransfersSchema,
} from "@/utils/naira-transfers";
import type { FiatOrder, FiatQuote, FiatRoute } from "@/utils/fiat";
import { BankAccountNotFoundError, type Bank } from "@/utils/bank-directory";
import type {
  UnifiedOrder,
  UnifiedQuote,
  UnifiedQuoteInput,
} from "@/utils/unified-fiat";

/**
 * In-memory fiat backend for `EXPO_PUBLIC_SEED_DEMO`. Unlike the static read
 * fixtures in `devSeed.ts`, the naira flows only make sense as a sequence
 * (create an account, wait for the provider, send, watch it settle), so this
 * keeps state for the lifetime of the JS bundle and advances it on the clock.
 * A Metro reload resets it to a user with no account.
 */

type BankAccountRecord = z.infer<typeof BankAccountRecordSchema>;

const ACCOUNT_READY_MS = 4_000;
const TRANSFER_SETTLE_MS = 3_000;
const ORDER_STEP_MS = 6_000;
const NGN_PER_USDC = 1_500n;
const UNIFIED_STEP_MS = 2_500;

const KNOWN_RECIPIENTS: Record<string, string> = {
  "0987654321": "Tobi Adeyemi",
  "0246813579": "Chiamaka Eze",
};

const iso = (ms = Date.now()) => new Date(ms).toISOString();
const latency = () => new Promise((r) => setTimeout(r, 700));
const uuid = () =>
  "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  );

const state: {
  account: BankAccountRecord | null;
  accountReadyAt: number;
  holder: string;
  ngnMinor: bigint;
  usdcMinor: bigint;
  unifiedQuotes: Map<string, UnifiedQuote>;
  unifiedOrders: (UnifiedOrder & { startedAt: number })[];
  transfers: (NairaTransfer & { settlesAt?: number })[];
  orders: (FiatOrder & { startedAt: number })[];
  quotes: Map<string, FiatQuote>;
} = {
  account: null,
  accountReadyAt: 0,
  holder: "",
  ngnMinor: 0n,
  usdcMinor: 2_847_500_000n,
  unifiedQuotes: new Map(),
  unifiedOrders: [],
  transfers: [],
  orders: [],
  quotes: new Map(),
};

function settleAccount() {
  const a = state.account;
  if (a?.status !== "creating" || Date.now() < state.accountReadyAt) return;
  state.account = {
    ...a,
    status: "active",
    updatedAt: iso(),
    account: {
      provider: "paga",
      reference: a.id,
      accountNumber: "0123456789",
      accountName: state.holder,
      bankName: "Paga",
      currency: "NGN",
      custody: "pooled",
    },
  };
  state.ngnMinor = 38_542_050n;
  state.transfers = [
    {
      id: uuid(),
      provider: "paga",
      environment: "sandbox",
      currency: "NGN",
      status: "completed",
      sourceAccountNumber: "0123456789",
      destination: { accountNumber: "0987654321", accountName: "Tobi Adeyemi" },
      amountMinor: "2500000",
      feeMinor: null,
      narration: "Xend transfer",
      expiresAt: iso(),
      createdAt: iso(Date.now() - 3_600_000),
      updatedAt: iso(Date.now() - 3_600_000),
      providerReference: "demo-paga-transfer",
    },
  ];
}

function settleTransfers() {
  for (const t of state.transfers) {
    if (t.status === "submitting" && Date.now() >= (t.settlesAt ?? 0)) {
      t.status = "completed";
      t.updatedAt = iso();
      t.providerReference = `demo-${t.id.slice(0, 8)}`;
    }
  }
}

const ORDER_STEPS: Record<"receive" | "send", FiatOrder["status"][]> = {
  receive: ["awaiting_payment", "processing", "completed"],
  send: ["processing", "completed"],
};

function advanceOrders() {
  for (const o of state.orders) {
    const steps = ORDER_STEPS[o.route.direction];
    const i = Math.min(
      steps.length - 1,
      Math.floor((Date.now() - o.startedAt) / ORDER_STEP_MS)
    );
    if (o.status !== steps[i]) {
      o.status = steps[i];
      o.updatedAt = iso();
    }
  }
}

const publicTransfer = ({ settlesAt: _, ...t }: (typeof state.transfers)[0]) =>
  t;
const publicOrder = ({ startedAt: _, ...o }: (typeof state.orders)[0]) => o;

const DEMO_BANKS: Bank[] = [
  { code: "044", name: "Access Bank" },
  { code: "011", name: "First Bank of Nigeria" },
  { code: "058", name: "GTBank" },
  { code: "090267", name: "Kuda Microfinance Bank" },
  { code: "090405", name: "Moniepoint Bank" },
  { code: "090645", name: "Nombank MFB" },
  { code: "100033", name: "Palmpay" },
  { code: "305", name: "Paycom (Opay)" },
  { code: "033", name: "United Bank for Africa" },
  { code: "057", name: "Zenith Bank" },
];

export const demoFiat = {
  async banks(): Promise<Bank[]> {
    return DEMO_BANKS;
  },
  async bankCandidates(accountNumber: string): Promise<Bank[]> {
    const codes =
      accountNumber === "7784374958"
        ? ["090645", "305"]
        : ["305", "058", "044"];
    return DEMO_BANKS.filter((bank) => codes.includes(bank.code));
  },
  async resolveBankRecipient(accountNumber: string, bankCode: string) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    const bank = DEMO_BANKS.find((candidate) => candidate.code === bankCode);
    if (!bank || accountNumber === "0000000000")
      throw new BankAccountNotFoundError();
    return {
      accountNumber,
      bankCode,
      bankName: bank.name,
      accountName: "Tobi Adeyemi",
    };
  },
  async bankAccounts(): Promise<z.infer<typeof BankAccountsSchema>> {
    settleAccount();
    return {
      provider: "paga",
      environment: "sandbox",
      available: true,
      reconciliationAvailable: true,
      accounts: state.account ? [state.account] : [],
    };
  },

  async createBankAccount(input: BankAccountInput) {
    await latency();
    if (!state.account) {
      state.holder = `${input.firstName.trim()} ${input.lastName.trim()}`;
      state.accountReadyAt = Date.now() + ACCOUNT_READY_MS;
      state.account = {
        id: "demo-naira-account",
        provider: "paga",
        environment: "sandbox",
        currency: "NGN",
        status: "creating",
        account: null,
        createdAt: iso(),
        updatedAt: iso(),
      };
    }
    return state.account;
  },

  async reconcileBankAccount() {
    await latency();
    settleAccount();
    if (!state.account) throw new Error("No account to check");
    return state.account;
  },

  async observedBalances(): Promise<z.infer<typeof ObservedBalancesSchema>> {
    settleAccount();
    const active = state.account?.status === "active";
    const usdTotal =
      (state.ngnMinor * 100n) / (NGN_PER_USDC * 100n) +
      state.usdcMinor / 10_000n;
    return {
      mode: "observed",
      bankEnvironment: "sandbox",
      network: "devnet",
      holdings: [
        active
          ? {
              currency: "NGN",
              decimals: 2,
              status: "available",
              amountMinor: state.ngnMinor.toString(),
              observedAt: iso(),
              reason: null,
            }
          : {
              currency: "NGN",
              decimals: 2,
              status: "unavailable",
              amountMinor: null,
              observedAt: null,
              reason: "no_owned_account",
            },
        {
          currency: "USDC",
          decimals: 6,
          status: "available",
          amountMinor: state.usdcMinor.toString(),
          observedAt: iso(),
          reason: null,
        },
      ],
      total: active
        ? {
            currency: "USD",
            amountMinor: usdTotal.toString(),
            estimate: true,
            asOf: iso(),
          }
        : null,
      valuationReason: active ? null : "bank_balance_unavailable",
    };
  },

  async nairaTransfers(): Promise<z.infer<typeof NairaTransfersSchema>> {
    settleAccount();
    settleTransfers();
    return {
      environment: "sandbox",
      available: state.account?.status === "active",
      scope: "xend_paga_accounts",
      transfers: state.transfers.map(publicTransfer),
    };
  },

  async quoteNairaTransfer(accountNumber: string, amountMinor: string) {
    await latency();
    const name = KNOWN_RECIPIENTS[accountNumber];
    if (!name)
      throw new Error(
        "No Xend Paga account matches that number. Try 0987654321."
      );
    if (BigInt(amountMinor) > state.ngnMinor)
      throw new Error("That amount is more than your naira balance.");
    const quote: NairaTransfer = {
      id: uuid(),
      provider: "paga",
      environment: "sandbox",
      currency: "NGN",
      status: "quoted",
      sourceAccountNumber: "0123456789",
      destination: { accountNumber, accountName: name },
      amountMinor,
      feeMinor: null,
      narration: "Xend transfer",
      expiresAt: iso(Date.now() + 300_000),
      createdAt: iso(),
      updatedAt: iso(),
      providerReference: null,
    };
    state.transfers.unshift(quote);
    return quote;
  },

  async sendNairaTransfer(quoteId: string) {
    await latency();
    const t = state.transfers.find((x) => x.id === quoteId);
    if (!t) throw new Error("Preview not found. Check the recipient again.");
    if (t.status === "quoted") {
      if (BigInt(t.amountMinor) > state.ngnMinor)
        throw new Error("That amount is more than your naira balance.");
      state.ngnMinor -= BigInt(t.amountMinor);
      t.status = "submitting";
      t.updatedAt = iso();
      t.settlesAt = Date.now() + TRANSFER_SETTLE_MS;
    }
    return publicTransfer(t);
  },

  routes(): FiatRoute[] {
    const route = (direction: "receive" | "send"): FiatRoute => ({
      id: `fonbnk:${direction}`,
      provider: "fonbnk",
      direction,
      environment: "sandbox",
      sourceCurrency: direction === "receive" ? "NGN" : "USDC",
      destinationCurrency: direction === "receive" ? "USDC" : "NGN",
      network: "solana",
      quoteAvailable: true,
      orderAvailable: true,
      accountKinds: [],
      holdsFiat: false,
      thirdPartyPayments: "unknown",
    });
    return [route("receive"), route("send")];
  },

  async quote(routeId: string, amountMinor: string): Promise<FiatQuote> {
    await latency();
    const route = this.routes().find((r) => r.id === routeId);
    if (!route) throw new Error("Demo route is unavailable");
    const receive = route.direction === "receive";
    const credit = receive
      ? (BigInt(amountMinor) * 10_000n) / NGN_PER_USDC
      : (BigInt(amountMinor) * NGN_PER_USDC) / 10_000n;
    const quote: FiatQuote = {
      id: `demo-quote-${uuid()}`,
      route,
      reference: "demo-provider-quote",
      expiresAt: iso(Date.now() + 600_000),
      debit: {
        currency: route.sourceCurrency,
        amountMinor,
        decimals: receive ? 2 : 6,
      },
      credit: {
        currency: route.destinationCurrency,
        amountMinor: credit.toString(),
        decimals: receive ? 6 : 2,
      },
      fees: [],
      fields: receive
        ? []
        : [
            {
              key: "accountNumber",
              label: "Destination account number",
              required: true,
              type: "text",
            },
          ],
      paymentStep: "manual_transfer",
    };
    state.quotes.set(quote.id, quote);
    return quote;
  },

  async createOrder(quoteId: string, fields: Record<string, string>) {
    await latency();
    const quote = state.quotes.get(quoteId);
    if (!quote) throw new Error("Get a fresh quote before continuing.");
    const receive = quote.route.direction === "receive";
    const order = {
      id: `demo-order-${uuid()}`,
      route: quote.route,
      quote,
      status: receive ? "awaiting_payment" : "processing",
      instructions: receive
        ? {
            kind: "bank_transfer",
            message:
              "Transfer the exact amount from your bank app. Your USDC arrives once the payment is confirmed.",
            accountNumber: "8012345678",
            bankName: "Wema Bank",
            accountName: "Fonbnk Collections",
            expiresAt: quote.expiresAt,
          }
        : {
            kind: "crypto_transfer",
            message: `Naira will be paid to ${fields.accountNumber ?? "your account"} once the USDC settles.`,
          },
      createdAt: iso(),
      updatedAt: iso(),
      simulation: false,
      startedAt: Date.now(),
    } satisfies (typeof state.orders)[0];
    state.orders.unshift(order);
    return publicOrder(order);
  },

  async orders() {
    advanceOrders();
    return { orders: state.orders.map(publicOrder) };
  },

  async order(id: string) {
    advanceOrders();
    const o = state.orders.find((x) => x.id === id);
    if (!o) throw new Error("Order not found");
    return publicOrder(o);
  },
  async unifiedFiat(displayCurrency: "USD" | "NGN") {
    settleAccount();
    advanceUnified();
    const ngnAsKobo = state.ngnMinor;
    const usdcAsKobo = (state.usdcMinor * NGN_PER_USDC) / 10_000n;
    const totalKobo = ngnAsKobo + usdcAsKobo;
    const total =
      displayCurrency === "NGN" ? totalKobo : totalKobo / NGN_PER_USDC;
    return {
      mode: "simulation" as const,
      holdings: {
        NGN: { settledMinor: state.ngnMinor.toString(), reservedMinor: "0" },
        USDC: { settledMinor: state.usdcMinor.toString(), reservedMinor: "0" },
      },
      total: {
        currency: displayCurrency,
        decimals: 2 as const,
        totalMinor: total.toString(),
        availableMinor: total.toString(),
        estimate: true as const,
      },
      orders: state.unifiedOrders.map(publicUnified),
    };
  },

  async unifiedQuote(input: UnifiedQuoteInput): Promise<UnifiedQuote> {
    await latency();
    settleAccount();
    const recipient = BigInt(input.recipientMinor ?? "0");
    if (recipient <= 0n) throw new Error("Enter an amount to send.");
    const direct = recipient < state.ngnMinor ? recipient : state.ngnMinor;
    const shortfall = recipient - direct;
    const usdcNeeded =
      shortfall === 0n
        ? 0n
        : (shortfall * 10_000n + NGN_PER_USDC - 1n) / NGN_PER_USDC;
    if (usdcNeeded > state.usdcMinor)
      throw new Error("That amount is more than your balance.");
    const expiresAt = iso(Date.now() + 600_000);
    const quote: UnifiedQuote = {
      id: `demo-unified-quote-${uuid()}`,
      destination: input.destination,
      expiresAt,
      mode: "simulation",
      plan: {
        destinationCurrency: "NGN",
        recipientMinor: recipient.toString(),
        payoutFeeMinor: "0",
        directMinor: direct.toString(),
        shortfallMinor: shortfall.toString(),
        conversionSource: "USDC",
        availableConversionSourceMinor: state.usdcMinor.toString(),
        reservations: {
          NGN: direct.toString(),
          USDC: usdcNeeded.toString(),
        },
        surplusDestinationMinor: "0",
        conversion:
          shortfall === 0n
            ? null
            : {
                reference: `demo-conversion-${uuid()}`,
                sourceCurrency: "USDC",
                destinationCurrency: "NGN",
                sourceDebitMinor: usdcNeeded.toString(),
                destinationCreditMinor: shortfall.toString(),
                expiresAt,
              },
      },
    };
    state.unifiedQuotes.set(quote.id, quote);
    return quote;
  },

  async unifiedCreateOrder(quoteId: string, autoAdvance = true) {
    await latency();
    const existing = state.unifiedOrders.find(
      (o) => o.id === `order-${quoteId}`
    );
    if (existing) return publicUnified(existing);
    const quote = state.unifiedQuotes.get(quoteId);
    if (!quote || Date.parse(quote.expiresAt) <= Date.now())
      throw new Error("This preview expired. Review the transfer again.");
    const { reservations, conversion } = quote.plan;
    if (
      BigInt(reservations.NGN) > state.ngnMinor ||
      BigInt(reservations.USDC) > state.usdcMinor
    )
      throw new Error("That amount is more than your balance.");
    state.ngnMinor -= BigInt(reservations.NGN);
    state.usdcMinor -= BigInt(reservations.USDC);
    const order = {
      id: `order-${quoteId}`,
      plan: quote.plan,
      destination: quote.destination,
      mode: "simulation" as const,
      status: conversion ? ("converting" as const) : ("sending" as const),
      createdAt: iso(),
      autoAdvance,
      startedAt: Date.now(),
    };
    state.unifiedOrders.unshift(order);
    return publicUnified(order);
  },
};

const UNIFIED_STEPS: UnifiedOrder["status"][] = [
  "converting",
  "sending",
  "completed",
];

function advanceUnified() {
  for (const o of state.unifiedOrders) {
    const start = o.plan.conversion ? 0 : 1;
    const i = Math.min(
      UNIFIED_STEPS.length - 1,
      start + Math.floor((Date.now() - o.startedAt) / UNIFIED_STEP_MS)
    );
    o.status = UNIFIED_STEPS[i];
  }
}

const publicUnified = ({
  startedAt: _,
  ...o
}: (typeof state.unifiedOrders)[0]): UnifiedOrder => o;
