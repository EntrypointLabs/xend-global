import type { AwaitingPayment } from "@/utils/apiClient";

/**
 * A stateful stand-in for the pending-payment endpoints under
 * EXPO_PUBLIC_SEED_DEMO, so the approval takeover can be walked end to end on a
 * simulator, where neither the passkey nor the device key can sign.
 *
 * `EXPO_PUBLIC_SEED_APPROVAL=none` starts with nothing waiting. A Metro reload
 * resets it.
 */
const QUOTE_MINUTES = 15;

type DemoState = "created" | "authorized" | "succeeded" | "canceled";

const payments = new Map<
  string,
  { payment: AwaitingPayment; state: DemoState }
>();

function seed(reference: string, merchant: string, minor: string) {
  const now = Date.now();
  payments.set(reference, {
    state: "created",
    payment: {
      reference,
      merchantDisplayName: merchant,
      displayCurrency: "NGN",
      displayAmountMinor: minor,
      usdcSettlementRaw: String(
        Math.round(Number(minor) / 100 / 1600) * 1_000_000
      ),
      deferredAt: new Date(now - 20_000).toISOString(),
      expiresAt: new Date(now + QUOTE_MINUTES * 60_000).toISOString(),
      merchantReference: "Order 10482",
    },
  });
}

if (process.env.EXPO_PUBLIC_SEED_APPROVAL !== "none") {
  seed("pi_demo_sabi", "Sabi Market", "24500000");
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function entry(reference: string) {
  const found = payments.get(reference);
  if (!found) throw new Error(`demo payment ${reference} not found`);
  return found;
}

export const demoApproval = {
  list(): AwaitingPayment[] {
    return [...payments.values()]
      .filter((p) => p.state === "created")
      .map((p) => p.payment);
  },
  async prepare(reference: string) {
    await pause(500);
    entry(reference).state = "authorized";
    return { unsignedTxBase64: "", needsApprovalSignature: true };
  },
  async submit(reference: string) {
    await pause(700);
    entry(reference).state = "succeeded";
    return "demo-signature";
  },
  async status(reference: string) {
    return entry(reference).state;
  },
  async decline(reference: string) {
    await pause(400);
    entry(reference).state = "canceled";
    return "canceled";
  },
  /** Puts a fresh Payment on the list, as a checkout handing one over would. */
  request(reference: string) {
    if (!payments.has(reference)) seed(reference, "Sabi Market", "24500000");
  },
};
