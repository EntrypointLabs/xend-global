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
import { settleTransferInFeed } from "@/utils/transferFeed";
import { signWithApprovalSigner } from "@/modules/hardware-key/src/turnkeySign";
import { signPresenceProof } from "@/modules/hardware-key/src/presence";
import { SIGN_PROMPT } from "@/modules/hardware-key/src";
import {
  apiClient,
  type PrepareTransferResponse,
  type SubmitTransferResponse,
} from "@/utils/apiClient";
import { checkSpend, MISMATCH_MESSAGE } from "@/utils/verifyTransaction";
import { isUserCanceledSign } from "@/utils/signing";
import { toRawAmount, WRAPPED_SOL_MINT } from "@/utils/swap";
import { getUsdcMint } from "@/utils/cluster";
import { showToast } from "@/utils/toast";
import { bucketAmount, trackFlow } from "@/utils/analytics";
import {
  fiatErrorCode,
  fiatErrorMessage,
  minorToPlain,
  type FiatOrder,
} from "@/utils/fiat";
import type { BankRecipient } from "@/components/ui/organisms/send/bankAccount";

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

/** Where preparing a bank send left off: ready to review, or blocked. */
export type BankPrepared =
  | { status: "review"; order: FiatOrder }
  | { status: "verify" }
  | { status: "failed"; reason: string };

const SEND_TOAST_ID = "send";
const SENDING_TOAST_MS = 15_000;
const FAILED_TOAST_MS = 5_000;

const NETWORK_BUSY = "The network is busy. Nothing has been sent.";
const NOT_CONFIRMED = "We could not confirm it was you. Nothing has been sent.";
const TOO_SLOW = "This took too long. Nothing has been sent.";
const UNKNOWN_OUTCOME =
  "We could not tell whether it went through. Sending again cannot send twice.";
const SOMETHING_WRONG = "Something went wrong. Nothing has been sent.";
const EMPTY_ADDRESS_NEEDS_MORE_SOL =
  "That address is empty, so it needs at least 0.00089 SOL to open. Send a little more.";
const TOKEN_CANNOT_BE_SENT =
  "This token cannot be sent. Nothing has been sent.";
const NOT_ENOUGH_PLAIN_SOL =
  "Some of your SOL is wrapped and cannot be sent. Send a little less.";

/** The token a crypto send moves: its mint, and the decimals amounts use. */
export interface SendToken {
  mint: string;
  decimals: number;
}
const NOT_READY = "Your Account is not ready yet. Try again in a moment.";

export type SendTracking = {
  flow: ReturnType<typeof trackFlow>;
  /** The caller reports success itself, as a bank payout settles off chain. */
  settlesElsewhere?: boolean;
};

function toastSending() {
  showToast(
    "Sending",
    <ActivityIndicator size="small" className="text-foreground" />,
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

function toastPaidOut() {
  showToast(
    "Paid to their bank",
    <Ionicons name="checkmark-circle" size={16} className="text-success" />,
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

const TRANSFER_POLL_MS = 1_000;

/**
 * The backend answers a submit as soon as the transaction is broadcast, which
 * is still PENDING. Watches the row only while the Sending toast is on screen,
 * so the toast can turn into Sent or Failed in place; after that, Activity is
 * where the outcome shows.
 */
async function waitForTransfer(
  transferId: string,
  deadline: number
): Promise<"CONFIRMED" | "FAILED" | "PENDING"> {
  while (Date.now() < deadline) {
    try {
      const { transfers } = await apiClient.listTransfers({ limit: 10 });
      const status = transfers.find((t) => t.id === transferId)?.status;
      if (status === "CONFIRMED" || status === "FAILED") return status;
    } catch {
      // A missed read says nothing about the transfer; the next one might.
    }
    const wait = Math.min(TRANSFER_POLL_MS, deadline - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }
  return "PENDING";
}

const ORDER_POLL_MS = 5_000;
const ORDER_POLL_LIMIT = 120;
export const BANK_SEND_ROUTE = "paycrest:usdc-ngn";

/** The payout's settled state, or "pending" while it is still moving. */
async function waitForFiatOrder(
  id: string
): Promise<"completed" | "returned" | "pending"> {
  for (let i = 0; i < ORDER_POLL_LIMIT; i++) {
    await new Promise((resolve) => setTimeout(resolve, ORDER_POLL_MS));
    try {
      const { status } = await apiClient.fiatOrder(id);
      if (status === "completed") return "completed";
      if (status === "returned" || status === "return_pending")
        return "returned";
      if (status === "failed" || status === "expired") return "pending";
    } catch {
      // A missed read says nothing about the payout; the next one might.
    }
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
    async (
      recipient: string,
      amount: string,
      token?: SendToken,
      tracking?: SendTracking
    ): Promise<SendStart> => {
      const flow = tracking?.flow ?? trackFlow("send", { rail: "wallet" });
      const embeddedWallet = embeddedSolana.wallets?.[0];
      if (!embeddedWallet) {
        flow.failed("not_ready");
        return { status: "failed", reason: NOT_READY };
      }

      const mint = token?.mint ?? getUsdcMint();
      // The backend wants the integer at the token's own decimals, built from
      // the typed digits rather than through a float.
      const amountRaw = toRawAmount(amount, token?.decimals ?? 6);
      const key = `${recipient}:${mint}:${amountRaw}`;

      if (pendingCrypto && pendingCrypto.key !== key) pendingCrypto = null;
      // A retry that already holds a signed transfer resumes at the submit
      // rather than replaying checks the Consumer has done once.
      let prepared = pendingCrypto?.submission ?? null;
      let needsApproval: boolean | undefined;

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
              flow.failed(err.data.code);
              return { status: "failed", reason: NETWORK_BUSY };
            } else if (err?.data?.code === "BELOW_RENT_MINIMUM") {
              flow.failed(err.data.code);
              return { status: "failed", reason: EMPTY_ADDRESS_NEEDS_MORE_SOL };
            } else if (err?.data?.code === "INSUFFICIENT_SOL") {
              flow.failed(err.data.code);
              return { status: "failed", reason: NOT_ENOUGH_PLAIN_SOL };
            } else if (err?.data?.code === "UNSUPPORTED_MINT") {
              flow.failed(err.data.code);
              return { status: "failed", reason: TOKEN_CANNOT_BE_SENT };
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
            // SOL leaves the vault as plain SOL, which the reader names as such.
            mint: mint === WRAPPED_SOL_MINT ? "SOL" : mint,
            amountRaw,
          });
          if (mismatch) {
            Sentry.captureException(new Error(`spend mismatch: ${mismatch}`), {
              tags: { surface: "send.crypto" },
            });
            flow.failed("spend_mismatch");
            return { status: "failed", reason: MISMATCH_MESSAGE };
          }

          let signedBase64: string;
          let presenceProof: string | undefined;
          needsApproval = prep.needsApprovalSignature;
          try {
            const provider = await embeddedWallet.getProvider();
            let tx = VersionedTransaction.deserialize(
              toByteArray(prep.unsignedTxBase64)
            );

            // A send from inside the app carries both keys. The approval signer
            // has to go first: Turnkey's policy engine evaluates the payload it
            // is handed, and the activity is documented as unsigned in /
            // signed out rather than additive. The primary then fills its own
            // signature slot silently, so this is the only Face ID the send
            // asks for. Submitting one signature short is rejected on chain.
            if (prep.needsApprovalSignature) {
              if (!account) throw new Error("Account not loaded");
              const signedHex = await signWithApprovalSigner({
                organizationId: account.approvalSubOrgId,
                signWith: account.signers.approval,
                unsignedTransaction: Buffer.from(
                  toByteArray(prep.unsignedTxBase64)
                ).toString("hex"),
                prompt: SIGN_PROMPT.send,
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
            if (isUserCanceledSign(err)) {
              flow.cancelled({ step: "sign" });
              return { status: "cancelled" };
            }
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
        flow.failed(error);
        return { status: "failed", reason: SOMETHING_WRONG };
      }

      const submission = prepared;
      flow.submitted({ needs_approval: needsApproval });
      toastSending();
      const sendingUntil = Date.now() + SENDING_TOAST_MS;
      void (async () => {
        let submitted: SubmitTransferResponse;
        try {
          submitted = await submitPrepared(submission);
        } catch (err: any) {
          const code = err?.data?.code;
          flow.failed(code ?? err);
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

        const settled = await waitForTransfer(
          submitted.transferId,
          sendingUntil
        );
        if (settled === "PENDING") return;
        settleTransferInFeed(queryClient, submitted.transferId, settled);
        invalidateAfterCryptoSend(queryClient);
        if (settled === "FAILED") {
          flow.failed("onchain_failed");
          toastFailed(`transfer ${submitted.transferId} failed on chain`);
          return;
        }
        if (!tracking?.settlesElsewhere) flow.succeeded();
        toastSent();
      })();

      return { status: "sending" };
    },
    [embeddedSolana.wallets, account, queryClient]
  );

  /**
   * First half of a bank send: price the payout, check the allowance, and open
   * the payout order. No money moves here; an order that is never funded just
   * expires at the partner. The result carries the exact USDC to send, fee
   * included, for the review screen.
   */
  const prepareBank = useCallback(
    async (
      recipient: BankRecipient,
      recipientMinor: string,
      note = ""
    ): Promise<BankPrepared> => {
      try {
        const quote = await apiClient.fiatQuote(
          BANK_SEND_ROUTE,
          recipientMinor,
          "credit"
        );
        if (quote.verification?.verificationRequired)
          return { status: "verify" };
        const order = await apiClient.fiatCreateOrder(
          quote.id,
          Crypto.randomUUID(),
          {
            bankCode: recipient.bankCode,
            accountNumber: recipient.accountNumber,
            ...(note.trim() ? { narration: note.trim() } : {}),
          }
        );
        const i = order.instructions;
        if (
          i.kind !== "crypto_transfer" ||
          !i.depositAddress ||
          !i.depositAmount ||
          i.depositAmount.currency !== "USDC"
        ) {
          Sentry.captureException(new Error("bank order without deposit"), {
            tags: { surface: "send.bank" },
          });
          return { status: "failed", reason: SOMETHING_WRONG };
        }
        return { status: "review", order };
      } catch (err) {
        if (fiatErrorCode(err) === "VERIFICATION_REQUIRED")
          return { status: "verify" };
        const reason = fiatErrorMessage(err);
        if (!reason)
          Sentry.captureException(err, { tags: { surface: "send.bank" } });
        return { status: "failed", reason: reason ?? SOMETHING_WRONG };
      }
    },
    []
  );

  /**
   * Second half: the Account pays the order's deposit address through the
   * ordinary signed transfer, so the same checks and prompts guard it as any
   * send. The bank leg is then followed in the background.
   */
  const fundBank = useCallback(
    async (order: FiatOrder): Promise<SendStart> => {
      const flow = trackFlow("naira_withdraw", {
        rail: "bank",
        provider: "paycrest",
        token: "USDC",
        amount_bucket: bucketAmount(
          minorToPlain(order.quote.credit.amountMinor, 2),
          "NGN"
        ),
      });
      const { depositAddress, depositAmount } = order.instructions;
      if (!depositAddress || !depositAmount) {
        flow.failed("missing_deposit");
        return { status: "failed", reason: SOMETHING_WRONG };
      }
      const start = await sendCrypto(
        depositAddress,
        minorToPlain(depositAmount.amountMinor, depositAmount.decimals),
        undefined,
        { flow, settlesElsewhere: true }
      );
      if (start.status === "sending") {
        void (async () => {
          const settled = await waitForFiatOrder(order.id);
          queryClient.invalidateQueries({ queryKey: ["fiat"] });
          if (settled === "returned") {
            flow.failed("payout_returned");
            toastFailed("The bank payout failed. Your USDC was returned.");
          } else if (settled === "completed") {
            flow.succeeded();
            toastPaidOut();
          }
        })();
      }
      return start;
    },
    [sendCrypto, queryClient]
  );

  return { sendCrypto, prepareBank, fundBank };
}
