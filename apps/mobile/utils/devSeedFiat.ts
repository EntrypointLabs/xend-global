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
const DEMO_LIMIT_MINOR = 5_000_000n;
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
  verification: "unverified" | "code_sent" | "verified";
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
  verification: "unverified",
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
      narration: "Prydd transfer",
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
  receive: [
    "awaiting_payment",
    "awaiting_payment",
    "awaiting_payment",
    "awaiting_payment",
    "awaiting_payment",
    "processing",
    "completed",
  ],
  send: ["awaiting_payment", "processing", "completed"],
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
  { code: "044", name: "Access Bank", logoKey: "access-bank" },
  { code: "011", name: "First Bank of Nigeria", logoKey: "first-bank" },
  { code: "058", name: "GTBank", logoKey: "gtbank" },
  { code: "090267", name: "Kuda Microfinance Bank", logoKey: "kuda" },
  { code: "090405", name: "Moniepoint Bank", logoKey: "moniepoint" },
  { code: "090645", name: "Nombank MFB" },
  { code: "100033", name: "Palmpay" },
  { code: "305", name: "Paycom (Opay)", logoKey: "opay" },
  { code: "033", name: "United Bank for Africa", logoKey: "uba" },
  { code: "057", name: "Zenith Bank", logoKey: "zenith-bank" },
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
      scope: "prydd_paga_accounts",
      transfers: state.transfers.map(publicTransfer),
    };
  },

  async quoteNairaTransfer(accountNumber: string, amountMinor: string) {
    await latency();
    const name = KNOWN_RECIPIENTS[accountNumber];
    if (!name)
      throw new Error(
        "No Prydd Paga account matches that number. Try 0987654321."
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
      narration: "Prydd transfer",
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
      id: direction === "receive" ? "paj:ngn-usdc" : "paycrest:usdc-ngn",
      provider: direction === "receive" ? "paj" : "paycrest",
      direction,
      environment: "production",
      sourceCurrency: direction === "receive" ? "NGN" : "USDC",
      destinationCurrency: direction === "receive" ? "USDC" : "NGN",
      network: "solana",
      quoteAvailable: true,
      orderAvailable: true,
      accountKinds: direction === "receive" ? ["temporary"] : [],
      holdsFiat: false,
      thirdPartyPayments: direction === "receive" ? "unknown" : "supported",
    });
    return [route("receive"), route("send")];
  },

  async quote(
    routeId: string,
    amountMinor: string,
    side: "debit" | "credit" = "debit"
  ): Promise<FiatQuote> {
    await latency();
    const route = this.routes().find((r) => r.id === routeId);
    if (!route) throw new Error("Demo route is unavailable");
    const receive = route.direction === "receive";
    const amount = BigInt(amountMinor);
    // Receive: kobo in, USDC out. Send (credit): kobo to the bank, USDC out.
    const naira =
      receive || side === "credit" ? amount : (amount * NGN_PER_USDC) / 10_000n;
    const usdc = receive
      ? (amount * 10_000n) / NGN_PER_USDC
      : side === "credit"
        ? (amount * 10_000n + NGN_PER_USDC - 1n) / NGN_PER_USDC
        : amount;
    const quote: FiatQuote = {
      id: `demo-quote-${uuid()}`,
      route,
      reference: "demo-provider-quote",
      expiresAt: iso(Date.now() + 120_000),
      debit: receive
        ? { currency: "NGN", amountMinor: naira.toString(), decimals: 2 }
        : { currency: "USDC", amountMinor: usdc.toString(), decimals: 6 },
      credit: receive
        ? { currency: "USDC", amountMinor: usdc.toString(), decimals: 6 }
        : { currency: "NGN", amountMinor: naira.toString(), decimals: 2 },
      fees: [],
      fields: receive
        ? []
        : [
            { key: "bankCode", label: "Bank", required: true, type: "text" },
            {
              key: "accountNumber",
              label: "Account number",
              required: true,
              type: "text",
            },
          ],
      paymentStep: receive ? "manual_transfer" : "account_transfer",
      verification: this.check(naira, receive ? "receive" : "send"),
    };
    state.quotes.set(quote.id, quote);
    return quote;
  },

  check(nairaMinor: bigint, direction: "receive" | "send") {
    const used = BigInt(this.usedMinor(direction));
    return {
      limitMinor: DEMO_LIMIT_MINOR.toString(),
      usedMinor: used.toString(),
      verificationRequired:
        state.verification !== "verified" &&
        (nairaMinor > DEMO_LIMIT_MINOR || used + nairaMinor > DEMO_LIMIT_MINOR),
    };
  },

  usedMinor(direction: "receive" | "send") {
    const since = Date.now() - 24 * 3_600_000;
    return state.orders
      .filter(
        (o) =>
          o.route.direction === direction &&
          !["failed", "expired", "returned"].includes(o.status) &&
          Date.parse(o.createdAt) >= since
      )
      .reduce(
        (sum, o) =>
          sum +
          BigInt(
            o.quote.debit.currency === "NGN"
              ? o.quote.debit.amountMinor
              : o.quote.credit.amountMinor
          ),
        0n
      )
      .toString();
  },

  async limits() {
    await latency();
    return {
      verified: state.verification === "verified",
      limitMinor: DEMO_LIMIT_MINOR.toString(),
      used: {
        receive: this.usedMinor("receive"),
        send: this.usedMinor("send"),
      },
      windowHours: 24,
    };
  },

  async createOrder(quoteId: string, fields: Record<string, string>) {
    await latency();
    const quote = state.quotes.get(quoteId);
    if (!quote) throw new Error("Get a fresh quote before continuing.");
    if (quote.verification?.verificationRequired)
      throw Object.assign(new Error("Verify your identity to continue."), {
        data: { code: "VERIFICATION_REQUIRED" },
        status: 403,
      });
    const receive = quote.route.direction === "receive";
    const fee = 100_000n;
    const order = {
      id: `demo-order-${uuid()}`,
      route: quote.route,
      quote,
      status: "awaiting_payment",
      instructions: receive
        ? {
            kind: "bank_transfer",
            message: "Transfer this exact amount once, from any Nigerian bank.",
            accountNumber: "9912345678",
            bankName: "Nombank MFB",
            accountName: `Paj Inc.(Pay NGN ${Number(BigInt(quote.debit.amountMinor) / 100n).toLocaleString("en-NG")}.00)`,
            transferAmount: quote.debit,
            expiresAt: iso(Date.now() + 30 * 60_000),
          }
        : {
            kind: "crypto_transfer",
            message:
              "Send this exact USDC from your Account to start the payout.",
            depositAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
            depositAmount: {
              currency: "USDC",
              amountMinor: (BigInt(quote.debit.amountMinor) + fee).toString(),
              decimals: 6,
            },
            payoutAccountName:
              KNOWN_RECIPIENTS[fields.accountNumber ?? ""] ?? "Account holder",
            expiresAt: iso(Date.now() + 30 * 60_000),
          },
      createdAt: iso(),
      updatedAt: iso(),
      simulation: false,
      startedAt: Date.now(),
    } satisfies (typeof state.orders)[0];
    state.orders.unshift(order);
    return publicOrder(order);
  },

  async payoutBanks() {
    await latency();
    return DEMO_BANKS;
  },

  // Tobi's number shows the suggested-bank path; any other number shows the
  // search path, as a number with no check-digit match would.
  async payoutCandidates(accountNumber: string) {
    await latency();
    const codes = accountNumber === "0987654321" ? ["058", "305", "044"] : [];
    return codes
      .map((code) => DEMO_BANKS.find((bank) => bank.code === code))
      .filter((bank): bank is Bank => bank !== undefined);
  },

  async payoutLookup(_bankCode: string, accountNumber: string) {
    await latency();
    const accountName = KNOWN_RECIPIENTS[accountNumber];
    if (!accountName) throw new BankAccountNotFoundError();
    return { accountName };
  },

  async verification() {
    await latency();
    return { status: state.verification };
  },

  async verificationConsent() {
    await latency();
    return {
      version: "v1",
      text: "I agree that Paj may check my BVN with the Nigeria Inter-Bank Settlement System and send a code to the phone number on my BVN record, to confirm my identity for naira transfers.",
    };
  },

  async startVerification(bvn: string) {
    await latency();
    if (!/^\d{11}$/.test(bvn)) throw new Error("Check your BVN and try again.");
    state.verification = "code_sent";
    return {
      status: state.verification,
      codeExpiresAt: iso(Date.now() + 10 * 60_000),
    };
  },

  async confirmVerification(code: string) {
    await latency();
    if (code !== "123456")
      throw Object.assign(
        new Error("That code didn't match. Check it and try again."),
        {
          data: { code: "WRONG_CODE" },
          status: 422,
        }
      );
    state.verification = "verified";
    return { status: state.verification };
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

/** Naira ramp legs for the seeded Activity feed, as the backend joins them. */
export const demoRampActivity = {
  deposit: {
    orderId: "demo-dep-1",
    direction: "receive",
    orderStatus: "completed",
    fiatCurrency: "NGN",
    fiatAmountMinor: "1000000",
    fiatDecimals: 2,
    rate: "1448.43",
    feeMinor: null,
    counterpartyName: null,
    bankName: null,
    bankCode: null,
    logoKey: null,
    accountLast4: null,
  },
  kudaSend: {
    orderId: "demo-send-1",
    direction: "send",
    orderStatus: "completed",
    fiatCurrency: "NGN",
    fiatAmountMinor: "500000",
    fiatDecimals: 2,
    rate: "1432.92",
    feeMinor: "23463",
    counterpartyName: "Ada Okafor",
    bankName: "Kuda Microfinance Bank",
    bankCode: "KUDANGPC",
    logoKey: "kuda",
    accountLast4: "6789",
  },
  // A send made before orders kept the bank: name only, no logo.
  legacySend: {
    orderId: "demo-send-0",
    direction: "send",
    orderStatus: "completed",
    fiatCurrency: "NGN",
    fiatAmountMinor: "200000",
    fiatDecimals: 2,
    rate: "1430.00",
    feeMinor: null,
    counterpartyName: "Chidi Nwosu",
    bankName: null,
    bankCode: null,
    logoKey: null,
    accountLast4: null,
  },
  gtbSend: {
    orderId: "demo-send-2",
    direction: "send",
    orderStatus: "completed",
    fiatCurrency: "NGN",
    fiatAmountMinor: "4500000",
    fiatDecimals: 2,
    rate: "1500.00",
    feeMinor: "100000",
    counterpartyName: "Tobi Adeyemi",
    bankName: "Guaranty Trust Bank",
    bankCode: "GTBINGLA",
    logoKey: "gtbank",
    accountLast4: "5678",
  },
  moniepointSend: {
    orderId: "demo-send-3",
    direction: "send",
    orderStatus: "returned",
    fiatCurrency: "NGN",
    fiatAmountMinor: "170000",
    fiatDecimals: 2,
    rate: "1431.63",
    feeMinor: "22768",
    counterpartyName: "Krispy Kreme Yaba",
    bankName: "Moniepoint MFB",
    bankCode: "MONINGPC",
    logoKey: "moniepoint",
    accountLast4: "7098",
  },
} as const;
