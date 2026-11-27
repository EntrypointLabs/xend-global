import { useEffect, useRef, useState } from "react";
import { Buffer } from "buffer";
import { useQueryClient } from "@tanstack/react-query";
import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import { toByteArray, fromByteArray } from "base64-js";
import { VersionedTransaction } from "@solana/web3.js";
import * as Sentry from "@sentry/react-native";

import { ACCOUNT_QUERY_KEY, useAccount } from "@/hooks/useAccount";
import { AWAITING_PAYMENTS_KEY } from "@/hooks/useAwaitingPayments";
import { SIGN_PROMPT } from "@/modules/hardware-key/src";
import { signWithApprovalSigner } from "@/modules/hardware-key/src/turnkeySign";
import { useAuth } from "@/contexts/AuthContext";
import {
  apiClient,
  apiErrorStatus,
  type AwaitingPayment,
} from "@/utils/apiClient";
import { isUserCanceledSign } from "@/utils/signing";
import { waitForPaymentOutcome } from "@/utils/paymentConfirmation";
import {
  deletePendingPaymentSubmission,
  loadPendingPaymentSubmissions,
  savePendingPaymentSubmission,
} from "@/utils/pendingPaymentSubmissions";
import { SEED_DEMO } from "@/utils/devSeed";
import { getUsdcMint } from "@/utils/cluster";
import { fetchPayoutWallet, storeOrigin } from "@/utils/merchantPayoutWallet";
import { checkPayment, MISMATCH_MESSAGE } from "@/utils/verifyTransaction";

export type ApprovalStep = "preparing" | "device" | "sending" | "confirming";

export type ApprovalPhase =
  | { kind: "idle" }
  | { kind: "working"; step: ApprovalStep }
  | { kind: "declining" }
  | { kind: "succeeded" }
  | { kind: "declined" }
  | {
      kind: "problem";
      /** `paused` means nothing went wrong and trying again is safe. */
      tone: "paused" | "failed";
      title: string;
      message: string;
      canRetry: boolean;
    };

const TERMINAL = new Set(["succeeded", "failed", "expired", "canceled"]);

function problem(
  tone: "paused" | "failed",
  title: string,
  message: string,
  canRetry: boolean
): ApprovalPhase {
  return { kind: "problem", tone, title, message, canRetry };
}

function terminalProblem(status: string): ApprovalPhase {
  if (status === "expired")
    return problem(
      "failed",
      "This quote expired",
      "Nothing was paid. Head back to the store for a new one.",
      false
    );
  if (status === "canceled")
    return problem(
      "failed",
      "Payment cancelled",
      "Nothing was paid. This payment can no longer be approved.",
      false
    );
  return problem(
    "failed",
    "The payment failed",
    "The network turned it down. Check Activity for details.",
    false
  );
}

/**
 * Approving or declining one Payment a checkout handed to this phone.
 *
 * Both signatures are produced here, in one transaction: the Spend is bound to
 * a single blockhash and would be dead long before anyone reached their phone
 * if the checkout collected one and the app added the other later.
 *
 * Once /prepare has run, the intent is authorized and cannot be prepared again,
 * so the signed bytes are saved before they are sent and a retry resends those
 * exact bytes.
 */
export function usePaymentApprovalFlow() {
  const queryClient = useQueryClient();
  const { data: account } = useAccount();
  const embeddedSolana = useEmbeddedSolanaWallet();
  const { user } = useAuth();
  const userId = user?.id;
  const [phase, setPhase] = useState<ApprovalPhase>({ kind: "idle" });
  const signed = useRef<Record<string, string>>({});
  const busy = useRef(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void loadPendingPaymentSubmissions(userId)
      .then((restored) => {
        if (cancelled) return;
        for (const [reference, pending] of Object.entries(restored)) {
          signed.current[reference] ??= pending.signedTransactionBase64;
        }
      })
      .catch((err: unknown) => Sentry.captureException(err));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const forget = async (reference: string) => {
    delete signed.current[reference];
    if (userId) await deletePendingPaymentSubmission(userId, reference);
  };

  const settled = (paid: boolean) => {
    void queryClient.invalidateQueries({ queryKey: AWAITING_PAYMENTS_KEY });
    if (!paid) return;
    void queryClient.invalidateQueries({ queryKey: ["transfers"] });
    void queryClient.invalidateQueries({ queryKey: ["balances"] });
    void queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY });
  };

  const submit = async (payment: AwaitingPayment, signedTxBase64: string) => {
    if (!userId) throw new Error("Authenticated user not loaded");
    signed.current[payment.reference] = signedTxBase64;
    await savePendingPaymentSubmission(userId, {
      payment,
      signedTransactionBase64: signedTxBase64,
    });
    setPhase({ kind: "working", step: "sending" });

    try {
      await apiClient.submitPayment(payment.reference, signedTxBase64);
    } catch (err) {
      Sentry.captureException(err);
      // The response may have been lost after the backend accepted it. Only a
      // terminal status retires the saved bytes.
      try {
        const status = await apiClient.paymentStatus(payment.reference);
        if (TERMINAL.has(status)) {
          await forget(payment.reference);
          settled(status === "succeeded");
          setPhase(
            status === "succeeded"
              ? { kind: "succeeded" }
              : terminalProblem(status)
          );
          return;
        }
      } catch {
        // Both unreachable: keep the bytes so a retry is safe.
      }
      setPhase(
        problem(
          "paused",
          "We couldn't reach Prydd",
          "Nothing new was signed. Try again to send the same approval.",
          true
        )
      );
      return;
    }

    await forget(payment.reference);
    void queryClient.invalidateQueries({ queryKey: AWAITING_PAYMENTS_KEY });
    setPhase({ kind: "working", step: "confirming" });

    const outcome = await waitForPaymentOutcome(() =>
      apiClient.paymentStatus(payment.reference)
    );
    settled(outcome === "succeeded");
    if (outcome === "succeeded") {
      setPhase({ kind: "succeeded" });
    } else if (outcome === "failed") {
      setPhase(terminalProblem("failed"));
    } else {
      setPhase(
        problem(
          "paused",
          "Still confirming",
          "Your approval was sent. Check Activity before trying again.",
          false
        )
      );
    }
  };

  const signAndSubmit = async (payment: AwaitingPayment) => {
    if (Date.parse(payment.expiresAt) <= Date.now()) {
      setPhase(terminalProblem("expired"));
      return;
    }
    const embeddedWallet = embeddedSolana.wallets?.find(
      (wallet) => wallet.address === account?.signers.primary
    );
    if (!SEED_DEMO && (!embeddedWallet || !account)) {
      setPhase(
        problem(
          "paused",
          "Your Account isn't ready",
          "Give it a moment, then try again. Nothing has been paid.",
          true
        )
      );
      return;
    }

    setPhase({ kind: "working", step: "preparing" });

    // Read before the backend prepares anything: a store that cannot say where
    // its money goes leaves the Payment untouched rather than authorized.
    let payoutWallet = "";
    if (!SEED_DEMO) {
      const origin = storeOrigin(payment.merchantOrigin);
      try {
        if (!origin) throw new Error("no store origin");
        payoutWallet = await fetchPayoutWallet(origin);
      } catch (err) {
        Sentry.captureException(err, { tags: { surface: "payment.payout" } });
        setPhase(
          problem(
            "paused",
            "We couldn't confirm this store",
            "Nothing has been paid. The store hasn't confirmed where Prydd payments go, so this can't be approved yet.",
            true
          )
        );
        return;
      }
    }

    const prepared = await apiClient.preparePayment(payment.reference);

    if (SEED_DEMO) {
      setPhase({ kind: "working", step: "device" });
      await new Promise((r) => setTimeout(r, 900));
      await submit(payment, "demo");
      return;
    }

    // Both phone keys sign this, and two keys can move the whole Account in
    // one go, so nothing is signed until the message is read back and found
    // to pay exactly the amount on the card and nothing else.
    const mismatch = checkPayment(prepared.unsignedTxBase64, {
      vault: account!.address,
      mint: getUsdcMint(),
      amountRaw: payment.usdcSettlementRaw,
      payoutWallet,
    });
    if (mismatch) {
      Sentry.captureException(new Error(`payment mismatch: ${mismatch}`), {
        tags: { surface: "payment.approve" },
      });
      setPhase(
        problem("failed", "That didn't go through", MISMATCH_MESSAGE, false)
      );
      return;
    }

    let tx = VersionedTransaction.deserialize(
      toByteArray(prepared.unsignedTxBase64)
    );
    // The approval signer goes first. Turnkey's activity is unsigned in,
    // signed out rather than additive, so the primary's signature would be
    // lost if it went first.
    if (prepared.needsApprovalSignature) {
      setPhase({ kind: "working", step: "device" });
      const signedHex = await signWithApprovalSigner({
        organizationId: account!.approvalSubOrgId,
        signWith: account!.signers.approval,
        unsignedTransaction: Buffer.from(
          toByteArray(prepared.unsignedTxBase64)
        ).toString("hex"),
        prompt: SIGN_PROMPT.payment,
      });
      tx = VersionedTransaction.deserialize(Buffer.from(signedHex, "hex"));
    }

    setPhase({ kind: "working", step: "sending" });
    const provider = await embeddedWallet!.getProvider();
    const { signedTransaction } = await provider.request({
      method: "signTransaction",
      params: { transaction: tx },
    });
    await submit(payment, fromByteArray(signedTransaction.serialize()));
  };

  const approve = async (payment: AwaitingPayment) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const saved = signed.current[payment.reference];
      if (saved) await submit(payment, saved);
      else await signAndSubmit(payment);
    } catch (err) {
      if (isUserCanceledSign(err)) {
        setPhase(
          problem(
            "paused",
            "Approval cancelled",
            "You closed the check. Nothing has been paid.",
            true
          )
        );
        return;
      }
      Sentry.captureException(err);
      const status = apiErrorStatus(err);
      if (status === 410) {
        setPhase(terminalProblem("expired"));
        return;
      }
      setPhase(
        problem(
          "failed",
          "That didn't go through",
          "Nothing has been paid. You can try again.",
          true
        )
      );
    } finally {
      busy.current = false;
    }
  };

  const decline = async (payment: AwaitingPayment) => {
    if (busy.current) return;
    busy.current = true;
    setPhase({ kind: "declining" });
    try {
      await apiClient.declinePayment(payment.reference);
      settled(false);
      setPhase({ kind: "declined" });
    } catch (err) {
      const status = apiErrorStatus(err);
      if (status === 409) {
        // Approve won the race, or the intent moved on without us.
        try {
          const current = await apiClient.paymentStatus(payment.reference);
          settled(current === "succeeded");
          setPhase(
            current === "succeeded"
              ? { kind: "succeeded" }
              : TERMINAL.has(current)
                ? terminalProblem(current)
                : problem(
                    "paused",
                    "Already being paid",
                    "This payment was approved a moment ago, so it can't be declined.",
                    false
                  )
          );
          return;
        } catch {
          // Fall through to the generic message.
        }
      }
      if (status === 410) {
        settled(false);
        setPhase(terminalProblem("expired"));
        return;
      }
      Sentry.captureException(err);
      setPhase(
        problem(
          "paused",
          "We couldn't reach Prydd",
          "The payment is still waiting. Try declining again.",
          false
        )
      );
    } finally {
      busy.current = false;
    }
  };

  const reset = () => setPhase({ kind: "idle" });

  return { phase, approve, decline, reset };
}
