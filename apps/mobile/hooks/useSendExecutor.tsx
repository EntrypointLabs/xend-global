import React, { useCallback } from "react";
import { ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import * as Sentry from "@sentry/react-native";
import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import { Buffer } from "buffer";
import { toByteArray, fromByteArray } from "base64-js";
import { VersionedTransaction } from "@solana/web3.js";
import { useAccount, ACCOUNT_QUERY_KEY } from "@/hooks/useAccount";
import { signWithApprovalSigner } from "@/modules/hardware-key/src/turnkeySign";
import {
  signBankSendPresence,
  signPresenceProof,
} from "@/modules/hardware-key/src/presence";
import { SIGN_PROMPT } from "@/modules/hardware-key/src";
import {
  apiClient,
  type PrepareTransferResponse,
  type SubmitTransferResponse,
} from "@/utils/apiClient";
import { checkSpend, MISMATCH_MESSAGE } from "@/utils/verifyTransaction";
import { isUserCanceledSign } from "@/utils/signing";
import { getUsdcMint } from "@/utils/cluster";
import { showToast } from "@/utils/toast";
import type { UnifiedOrder } from "@/utils/unified-fiat";
import {
  encodeBankDestination,
  type BankRecipient,
} from "@/components/ui/organisms/send/bankAccount";

/**
 * How a send left the amount step. Everything up to and including the
 * biometric happens with the sheet still open, so a cancel or a refusal leaves
 * the Consumer where they were; "sending" means the sheet can close and the
 * rest is reported by toast.
 */
export type SendStart =
  | { status: "cancelled" }
  | { status: "failed"; reason: string }
  | { status: "sending" };

const SEND_TOAST_ID = "send";
const SENDING_TOAST_MS = 5_000;
const FAILED_TOAST_MS = 5_000;

const NETWORK_BUSY = "The network is busy. Nothing has been sent.";
const NOT_CONFIRMED = "We could not confirm it was you. Nothing has been sent.";
const TOO_SLOW = "This took too long. Nothing has been sent.";
const UNKNOWN_OUTCOME =
  "We could not tell whether it went through. Sending again cannot send twice.";
const SOMETHING_WRONG = "Something went wrong. Nothing has been sent.";
const NOT_READY = "Your Account is not ready yet. Try again in a moment.";

function toastSending() {
  showToast(
    "Sending",
    <ActivityIndicator size="small" className="text-black" />,
    { id: SEND_TOAST_ID, durationMs: SENDING_TOAST_MS }
  );
}

function toastSent() {
  showToast(
    "Sent",
    <Ionicons name="checkmark-circle" size={16} className="text-success" />,
    { id: SEND_TOAST_ID, tone: "success" }
  );
}

/**
 * The toast only says it failed; Activity is where the Consumer reads what
 * happened. The reason is still logged so the failure can be traced.
 */
function toastFailed(reason: string, error?: unknown) {
  console.warn(`[send] ${reason}`, error ?? "");
  showToast(
    "Failed",
    <Ionicons name="close-circle" size={16} className="text-destructive" />,
    { id: SEND_TOAST_ID, durationMs: FAILED_TOAST_MS, tone: "failed" }
  );
}

function toastOnItsWay() {
  showToast(
    "On its way",
    <Ionicons name="time-outline" size={16} className="text-black" />,
    { id: SEND_TOAST_ID, durationMs: FAILED_TOAST_MS }
  );
}

/**
 * A prepared-and-signed transfer waiting to be submitted. Held across
 * attempts so a submit that fails ambiguously (timeout / dropped connection,
 * where the backend may already have accepted the tx) can be retried with the
 * SAME intentId, hitting the backend's idempotency guard on
 * transfers.intent_id, instead of preparing a fresh intent and signing a
 * second, non-idempotent transfer.
 *
 * Module scope because the sheet that started the send is gone by the time the
 * submit fails, and the retry arrives through a new one. Keyed by recipient and
 * amount so it is only ever replayed for the send it was signed for.
 */
type PendingSubmission = {
  intentId: string;
  signedTxBase64: string;
  /**
   * Held with the signature it accompanies so an ambiguous submit can be
   * retried without asking for the fingerprint a second time. The proof is
   * bound to this intent's message, so it stays valid exactly as long as the
   * transaction it was taken for.
   */
  presenceProof?: string;
};

let pendingCrypto: { key: string; submission: PendingSubmission } | null = null;

/**
 * An order create that failed ambiguously. Replaying the same quote and
 * idempotency key returns the order if it was made, rather than making a
 * second one.
 */
let pendingBank: {
  key: string;
  quoteId: string;
  idempotencyKey: string;
} | null = null;

/**
 * Submit the signed intent, retrying once on an ambiguous failure. A known
 * recoverable code (INTENT_EXPIRED / RPC_UNAVAILABLE) is rethrown for the
 * caller to handle; any other failure (timeout / dropped connection) may
 * mean the backend already accepted the tx, so we retry with the SAME
 * intentId (deduplicated on transfers.intent_id) rather than give up.
 */
async function submitPrepared(
  prepared: PendingSubmission
): Promise<SubmitTransferResponse> {
  try {
    return await apiClient.submitTransfer(prepared);
  } catch (err: any) {
    const code = err?.data?.code;
    if (code === "INTENT_EXPIRED" || code === "RPC_UNAVAILABLE") throw err;
    return await apiClient.submitTransfer(prepared);
  }
}

type BankRefusal = "balance" | "expired" | "other";

/**
 * A refusal means nothing was created and a fresh attempt is safe. Anything
 * else (a dropped connection, a server error) may have created the order, so
 * the retry has to replay the same request rather than start a new one.
 */
function bankRefusal(err: unknown): BankRefusal | null {
  const e = err as { status?: unknown; data?: { message?: unknown } } & Error;
  const text = String(e?.data?.message ?? e?.message ?? "");
  const refused =
    (typeof e?.status === "number" && e.status >= 400 && e.status < 500) ||
    /balance|expired/i.test(text);
  if (!refused) return null;
  if (/balance/i.test(text)) return "balance";
  if (/expired/i.test(text)) return "expired";
  return "other";
}

const REFUSAL_MESSAGE: Record<BankRefusal, string> = {
  balance: "That amount is more than your balance. Nothing has been sent.",
  expired: TOO_SLOW,
  other: SOMETHING_WRONG,
};

const ORDER_POLL_MS = 1_500;
const ORDER_POLL_LIMIT = 40;

/** The order's final state, or "pending" if it is still moving when the wait runs out. */
async function waitForOrder(
  id: string
): Promise<"completed" | "failed" | "pending"> {
  for (let i = 0; i < ORDER_POLL_LIMIT; i++) {
    try {
      const snapshot = await apiClient.unifiedFiat("NGN");
      const status = snapshot.orders.find((o) => o.id === id)?.status;
      if (status === "completed" || status === "failed") return status;
    } catch {
      // A missed read says nothing about the order; the next one might.
    }
    await new Promise((resolve) => setTimeout(resolve, ORDER_POLL_MS));
  }
  return "pending";
}

function invalidateAfterCryptoSend(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["transfers"] });
  queryClient.invalidateQueries({ queryKey: ["balances"] });
  // What is left of the daily limit went down with this send, and it is
  // what the amount screen warns from.
  queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY });
}

export function useSendExecutor() {
  const queryClient = useQueryClient();
  const embeddedSolana = useEmbeddedSolanaWallet();
  const { data: account } = useAccount();

  /**
   * Send flow: prepare, prove it is the Consumer, sign, then submit.
   *
   * The check in the middle is the only thing the Consumer does, and it happens
   * on exactly one of two keys depending on the route:
   *
   *  - Above the limit, the approval signer signs the transaction. That is a
   *    biometric on the device key, and it has to go first because Turnkey is
   *    specified as unsigned in, signed out.
   *  - Under the limit, nothing on the transaction needs the Consumer: the
   *    primary signs from a session. So the same device key signs the prepared
   *    message separately, and the backend refuses to broadcast without it.
   *
   * Either way it is one prompt on one key. Asking on both would prompt twice
   * for one send, and asking on neither is what let an unlocked phone spend.
   *
   * Everything through signing resolves before the sheet closes; the submit
   * runs after it, reported by toast.
   *
   * Error handling:
   *  - INTENT_EXPIRED (410) from prepare: re-prepare once automatically.
   *  - INTENT_EXPIRED (410) from submit: stop; do NOT silently re-sign,
   *    because the signature would mismatch the new blockhash.
   *  - User dismisses the biometric or the passkey: cancelled, nothing signed.
   *  - PRESENCE_REQUIRED / PRESENCE_INVALID (428/403): the backend refused
   *    before broadcasting, so the retry starts clean rather than reusing a
   *    proof that was already rejected.
   *  - RPC_UNAVAILABLE (502): stop, nothing sent.
   *  - Ambiguous submit failure (timeout / dropped connection with no
   *    known error code): the backend may already have accepted the signed
   *    tx, so we must NOT re-prepare: a fresh intentId would sign a second
   *    transfer and double-send. The prepared+signed intent is kept in
   *    pendingCrypto and resubmitted with the SAME intentId when the Consumer
   *    sends the same amount to the same recipient again, which the backend
   *    deduplicates on transfers.intent_id.
   *  - Privy session expiry: SDK silently re-prompts; we do NOT logout.
   */
  const sendCrypto = useCallback(
    async (recipient: string, amount: string): Promise<SendStart> => {
      const embeddedWallet = embeddedSolana.wallets?.[0];
      if (!embeddedWallet) return { status: "failed", reason: NOT_READY };

      const mint = getUsdcMint();
      // USDC has 6 decimals; backend wants the integer string at native
      // decimals. BigInt-safe construction future-proofs against larger
      // mints with 9 decimals.
      const amountRaw = BigInt(
        Math.round(Number(amount) * 1_000_000)
      ).toString();
      const key = `${recipient}:${amountRaw}`;

      if (pendingCrypto && pendingCrypto.key !== key) pendingCrypto = null;
      // A retry that already holds a signed transfer resumes at the submit
      // rather than replaying checks the Consumer has done once.
      let prepared = pendingCrypto?.submission ?? null;

      try {
        if (!prepared) {
          let prep: PrepareTransferResponse;
          try {
            prep = await apiClient.prepareTransfer({
              toAddress: recipient,
              mint,
              amountRaw,
            });
          } catch (err: any) {
            if (err?.data?.code === "INTENT_EXPIRED") {
              prep = await apiClient.prepareTransfer({
                toAddress: recipient,
                mint,
                amountRaw,
              });
            } else if (err?.data?.code === "RPC_UNAVAILABLE") {
              return { status: "failed", reason: NETWORK_BUSY };
            } else {
              throw err;
            }
          }

          // Read the prepared message back before either signature goes on it.
          // Both signatures are asked for on this phone, so nothing else would
          // notice a payload that is not the one on screen.
          const mismatch = checkSpend(prep.unsignedTxBase64, {
            vault: account?.address ?? "",
            destination: recipient,
            mint,
            amountRaw,
          });
          if (mismatch) {
            Sentry.captureException(new Error(`spend mismatch: ${mismatch}`), {
              tags: { surface: "send.crypto" },
            });
            return { status: "failed", reason: MISMATCH_MESSAGE };
          }

          let signedBase64: string;
          let presenceProof: string | undefined;
          try {
            const provider = await embeddedWallet.getProvider();
            let tx = VersionedTransaction.deserialize(
              toByteArray(prep.unsignedTxBase64)
            );

            // Above the spending limit the vault needs the approval signer too,
            // and it has to go first: Turnkey's policy engine evaluates the
            // payload it is handed, and the activity is documented as unsigned
            // in / signed out rather than additive. The primary then fills its
            // own signature slot and leaves this one intact.
            // Submitting one signature short is rejected on chain, not refused.
            if (prep.needsApprovalSignature) {
              if (!account) throw new Error("Account not loaded");
              const signedHex = await signWithApprovalSigner({
                organizationId: account.approvalSubOrgId,
                signWith: account.signers.approval,
                unsignedTransaction: Buffer.from(
                  toByteArray(prep.unsignedTxBase64)
                ).toString("hex"),
                prompt: SIGN_PROMPT.payment,
              });
              tx = VersionedTransaction.deserialize(
                Buffer.from(signedHex, "hex")
              );
            } else {
              // The signature below comes from a Privy session and asks the
              // Consumer for nothing, so this is the only thing standing
              // between an unlocked phone and the daily limit.
              presenceProof = await signPresenceProof(
                prep.unsignedTxBase64,
                SIGN_PROMPT.send
              );
            }

            const { signedTransaction } = await provider.request({
              method: "signTransaction",
              params: { transaction: tx },
            });
            signedBase64 = fromByteArray(signedTransaction.serialize());
          } catch (err) {
            // A dismissed prompt is a decision, not a fault, and nothing has
            // been signed.
            if (isUserCanceledSign(err)) return { status: "cancelled" };
            throw err;
          }

          prepared = {
            intentId: prep.intentId,
            signedTxBase64: signedBase64,
            presenceProof,
          };
          pendingCrypto = { key, submission: prepared };
        }
      } catch (error) {
        Sentry.captureException(error, { tags: { surface: "send.crypto" } });
        return { status: "failed", reason: SOMETHING_WRONG };
      }

      const submission = prepared;
      toastSending();
      void (async () => {
        try {
          await submitPrepared(submission);
        } catch (err: any) {
          const code = err?.data?.code;
          if (code === "INTENT_EXPIRED") {
            // The signed tx can no longer land; a fresh prepare is required.
            pendingCrypto = null;
            toastFailed(TOO_SLOW, err);
            return;
          }
          if (code === "PRESENCE_REQUIRED" || code === "PRESENCE_INVALID") {
            // Refused before broadcast, so there is nothing in flight to
            // protect and no reason to keep a proof the backend has already
            // rejected. The next send asks for the fingerprint again.
            pendingCrypto = null;
            toastFailed(NOT_CONFIRMED, err);
            return;
          }
          if (code === "RPC_UNAVAILABLE") {
            toastFailed(NETWORK_BUSY, err);
            return;
          }
          // Ambiguous failure after retry: keep the signed intent so the next
          // send of the same amount resubmits it (idempotently) instead of
          // re-preparing.
          Sentry.captureException(err, { tags: { surface: "send.crypto" } });
          toastFailed(UNKNOWN_OUTCOME);
          return;
        }

        // Submitted (or deduplicated): the intent is spent.
        if (pendingCrypto?.submission === submission) pendingCrypto = null;
        invalidateAfterCryptoSend(queryClient);
        toastSent();
      })();

      return { status: "sending" };
    },
    [embeddedSolana.wallets, account, queryClient]
  );

  /**
   * Bank send: quote, biometric, create the order, then wait for it to settle.
   *
   * The biometric is signed over the quote so it is tied to this payout. The
   * backend is a simulation today and does not check it; it is here so a bank
   * send cannot leave an unlocked phone without a face or fingerprint.
   */
  const sendBank = useCallback(
    async (
      recipient: BankRecipient,
      recipientMinor: string
    ): Promise<SendStart> => {
      const destination = encodeBankDestination(recipient);
      const key = `${destination}:${recipientMinor}`;

      if (pendingBank && pendingBank.key !== key) pendingBank = null;

      let create: { quoteId: string; idempotencyKey: string };
      try {
        if (pendingBank) {
          create = pendingBank;
        } else {
          let quoteId: string;
          try {
            const quote = await apiClient.unifiedQuote({
              destinationCurrency: "NGN",
              destination,
              recipientMinor,
            });
            quoteId = quote.id;
          } catch (err) {
            const refusal = bankRefusal(err);
            if (refusal)
              return { status: "failed", reason: REFUSAL_MESSAGE[refusal] };
            throw err;
          }
          create = { quoteId, idempotencyKey: Crypto.randomUUID() };
        }

        try {
          await signBankSendPresence(create.quoteId, SIGN_PROMPT.send);
        } catch (err) {
          if (isUserCanceledSign(err)) return { status: "cancelled" };
          throw err;
        }
      } catch (error) {
        Sentry.captureException(error, { tags: { surface: "send.bank" } });
        return { status: "failed", reason: SOMETHING_WRONG };
      }

      pendingBank = { key, ...create };
      toastSending();
      void (async () => {
        let order: UnifiedOrder;
        try {
          order = await apiClient.unifiedCreateOrder(
            create.quoteId,
            create.idempotencyKey,
            true
          );
        } catch (err) {
          const refusal = bankRefusal(err);
          if (!refusal) {
            Sentry.captureException(err, { tags: { surface: "send.bank" } });
            toastFailed(UNKNOWN_OUTCOME);
            return;
          }
          pendingBank = null;
          toastFailed(REFUSAL_MESSAGE[refusal], err);
          return;
        }
        // The order exists, so a later send of the same amount is a new
        // payment, not a replay of this one.
        pendingBank = null;

        const settled =
          order.status === "completed" || order.status === "failed"
            ? order.status
            : await waitForOrder(order.id);
        queryClient.invalidateQueries({ queryKey: ["fiat"] });
        if (settled === "pending") {
          toastOnItsWay();
          return;
        }
        if (settled === "failed") {
          toastFailed(`bank order ${order.id} failed`);
          return;
        }
        toastSent();
      })();

      return { status: "sending" };
    },
    [queryClient]
  );

  return { sendCrypto, sendBank };
}
