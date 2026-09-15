import React, { useRef, useState } from "react";
import { View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { ThemedScreen } from "@/components/ui/layout";
import { ThemedText, IconSymbol, LoadingSpinner } from "@/components/ui/atoms";
import { IconSymbolName } from "@/components/ui/atoms/IconSymbol";
import { router, useLocalSearchParams } from "expo-router";
import { isUserCanceledSign } from "@/utils/signing";
import { formatAmount } from "@/utils/helper";
import { useThemeColor } from "@/hooks/useThemeColor";
import { ButtonGroup } from "@/components/ui/molecules";
import {
  SpendCheckModal,
  type SpendCheckStep,
  type SpendCheckState,
} from "@/components/ui/organisms/modals/SpendCheckModal";
import { useToast } from "@/contexts/ToastContext";
import * as Sentry from "@sentry/react-native";
import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import { useAccount, ACCOUNT_QUERY_KEY } from "@/hooks/useAccount";
import { describeSecondCheck } from "@/utils/spendingLimit";
import { signWithApprovalSigner } from "@/modules/hardware-key/src/turnkeySign";
import { signPresenceProof } from "@/modules/hardware-key/src/presence";
import { SIGN_PROMPT } from "@/modules/hardware-key/src";
import { Buffer } from "buffer";
import {
  apiClient,
  PrepareTransferResponse,
  SubmitTransferResponse,
} from "@/utils/apiClient";
import { toByteArray, fromByteArray } from "base64-js";
import { VersionedTransaction } from "@solana/web3.js";
import { checkSpend, MISMATCH_MESSAGE } from "@/utils/verifyTransaction";

/**
 * Router params are typed as strings and are not guaranteed to be there, and
 * the modal renders its children whether or not it is visible, so an absent
 * recipient used to take this whole screen down rather than one line of it.
 */
function shortenAddress(address: string | undefined): string {
  if (!address) return "";
  return address.length > 12
    ? `${address.slice(0, 4)}...${address.slice(-4)}`
    : address;
}

// Real SPL mint address; prepareTransfer builds an actual transfer instruction.
const USDC_MINT = process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS ?? "";

/**
 * Detect the well-known shapes a Privy passkey ceremony surfaces when the
 * user dismisses the system prompt. The Privy SDK does not export a typed
 * `UserCancelled` error today; we string-match on the message/name to keep
 * a "stay on screen, prompt to retry" UX rather than a hard failure.
 */
/**
 * A prepared-and-signed transfer waiting to be submitted. Held across
 * Confirm taps so a submit that fails ambiguously (timeout / dropped
 * connection, where the backend may already have accepted the tx) can be
 * retried with the SAME intentId — hitting the backend's idempotency guard
 * on transfers.intent_id — instead of preparing a fresh intent and signing
 * a second, non-idempotent transfer.
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

/** Open for the length of a send; null before it starts and after it ends. */
type SendFlow = {
  step: SpendCheckStep;
  state: SpendCheckState;
  message: string | null;
  /**
   * Carried on the flow rather than read from the cached limit at render, so
   * the reason row follows what prepare answered for this send instead of
   * appearing and vanishing under it.
   */
  aboveLimit: boolean;
};

/**
 * How long "Sent" stays up before the success screen replaces it.
 *
 * The state is real by the time this runs; the pause only makes the last tick
 * legible after two prompts, which is the point of showing the steps at all.
 */
const SENT_DWELL_MS = 700;

const NETWORK_BUSY = "The network is busy. Nothing has been sent.";
const NOT_CONFIRMED = "We could not confirm it was you. Nothing has been sent.";

export default function ConfirmScreen() {
  const textColor = useThemeColor({}, "text");
  const [isLoading, setIsLoading] = useState(false);
  const { showToast } = useToast();
  const embeddedSolana = useEmbeddedSolanaWallet();
  const { data: account } = useAccount();
  const queryClient = useQueryClient();
  const pendingSubmission = useRef<PendingSubmission | null>(null);
  const [flow, setFlow] = useState<SendFlow | null>(null);
  /**
   * Which attempt owns the modal. An attempt the Consumer walked away from can
   * still be mid-request, and it must not report progress over the one they
   * started next.
   */
  const attempt = useRef(0);

  const { amount, recipient, name, type, title } = useLocalSearchParams<{
    amount: string;
    recipient: string;
    name: string;
    type: string;
    title: string;
  }>();

  /**
   * Submit the signed intent, retrying once on an ambiguous failure. A known
   * recoverable code (INTENT_EXPIRED / RPC_UNAVAILABLE) is rethrown for the
   * caller to handle; any other failure (timeout / dropped connection) may
   * mean the backend already accepted the tx, so we retry with the SAME
   * intentId — deduplicated on transfers.intent_id — rather than give up.
   */
  const submitPrepared = async (
    prepared: PendingSubmission
  ): Promise<SubmitTransferResponse> => {
    try {
      return await apiClient.submitTransfer(prepared);
    } catch (err: any) {
      const code = err?.data?.code;
      if (code === "INTENT_EXPIRED" || code === "RPC_UNAVAILABLE") throw err;
      return await apiClient.submitTransfer(prepared);
    }
  };

  /**
   * Send flow: prepare → prove it is the Consumer → sign → submit.
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
   * Error handling:
   *  - INTENT_EXPIRED (410) from prepare: re-prepare once automatically.
   *  - INTENT_EXPIRED (410) from submit: hold the step; do NOT silently
   *    re-sign, because the signature would mismatch the new blockhash.
   *  - User dismisses the biometric or the passkey: hold, nothing signed.
   *  - PRESENCE_REQUIRED / PRESENCE_INVALID (428/403): the backend refused
   *    before broadcasting, so the retry starts clean rather than reusing a
   *    proof that was already rejected.
   *  - RPC_UNAVAILABLE (502): hold, nothing sent.
   *  - Ambiguous submit failure (timeout / dropped connection with no
   *    known error code): the backend may already have accepted the signed
   *    tx, so we must NOT re-prepare — a fresh intentId would sign a second
   *    transfer and double-send. The prepared+signed intent is stashed in
   *    pendingSubmission and resubmitted with the SAME intentId on the next
   *    Confirm, which the backend deduplicates on transfers.intent_id.
   *  - Privy session expiry: SDK silently re-prompts; we do NOT logout.
   */
  const handleConfirm = async () => {
    if (!USDC_MINT) {
      showToast("USDC mint not configured");
      Sentry.captureException(
        new Error("EXPO_PUBLIC_USDC_MINT_ADDRESS missing on confirm.tsx")
      );
      return;
    }

    const embeddedWallet = embeddedSolana.wallets?.[0];
    if (!embeddedWallet) {
      showToast("Your Account is not ready yet, please try again");
      return;
    }

    // USDC has 6 decimals; backend wants the integer string at native
    // decimals. BigInt-safe construction future-proofs against larger
    // mints with 9 decimals.
    const amountRaw = BigInt(Math.round(Number(amount) * 1_000_000)).toString();

    const run = ++attempt.current;
    // The reason row is the only thing the limit decides. Guessing it from the
    // cached limit puts it on screen before prepare answers; prepare then
    // corrects it either way, because it is the one that actually knows.
    let aboveLimit = describeSecondCheck(account, amount)?.certain === true;
    let at: SpendCheckStep = aboveLimit ? "reason" : "identity";

    const show = (step: SpendCheckStep) => {
      at = step;
      if (run === attempt.current) {
        setFlow({ step, state: "working", message: null, aboveLimit });
      }
    };
    /**
     * Stops the send on the step it reached and says why. False only when the
     * Consumer has walked away from this attempt, where saying anything would
     * talk over the send they started next.
     */
    const hold = (state: "paused" | "failed", message: string) => {
      if (run !== attempt.current) return false;
      setFlow({ step: at, state, message, aboveLimit });
      return true;
    };

    // A retry that already holds a signed transfer resumes at the submit
    // rather than replaying checks the Consumer has done once.
    show(pendingSubmission.current ? "sending" : at);
    setIsLoading(true);
    try {
      // If a prior Confirm signed a transfer but the submit round-trip
      // failed ambiguously, reuse that exact intent+signature so a retry
      // hits the backend idempotency guard rather than double-sending.
      let prepared = pendingSubmission.current;

      if (!prepared) {
        // Prepare, with one automatic retry on INTENT_EXPIRED.
        let prep: PrepareTransferResponse;
        try {
          prep = await apiClient.prepareTransfer({
            toAddress: recipient,
            mint: USDC_MINT,
            amountRaw,
          });
        } catch (err: any) {
          if (err?.data?.code === "INTENT_EXPIRED") {
            prep = await apiClient.prepareTransfer({
              toAddress: recipient,
              mint: USDC_MINT,
              amountRaw,
            });
          } else if (err?.data?.code === "RPC_UNAVAILABLE") {
            hold("failed", NETWORK_BUSY);
            setIsLoading(false);
            return;
          } else {
            throw err;
          }
        }

        // The route is the backend's answer, not the cached limit's. Whether
        // the Account approves alongside the Consumer decides one row, so a
        // guess that turns out wrong is corrected here rather than left up.
        aboveLimit = prep.needsApprovalSignature === true;

        // Read the prepared message back before either signature goes on it.
        // Both signatures are asked for on this phone, so nothing else would
        // notice a payload that is not the one on screen.
        const mismatch = checkSpend(prep.unsignedTxBase64, {
          vault: account?.address ?? "",
          destination: recipient,
          mint: USDC_MINT,
          amountRaw,
        });
        if (mismatch) {
          Sentry.captureException(new Error(`spend mismatch: ${mismatch}`), {
            tags: { surface: "send.confirm" },
          });
          hold("failed", MISMATCH_MESSAGE);
          setIsLoading(false);
          return;
        }

        let signedBase64: string;
        let presenceProof: string | undefined;
        try {
          const provider = await embeddedWallet.getProvider();
          let tx = VersionedTransaction.deserialize(
            toByteArray(prep.unsignedTxBase64)
          );

          show("identity");

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
            // Consumer for nothing, so this is the only thing standing between
            // an unlocked phone and the daily limit.
            presenceProof = await signPresenceProof(
              prep.unsignedTxBase64,
              SIGN_PROMPT.send
            );
          }

          show("sending");
          const { signedTransaction } = await provider.request({
            method: "signTransaction",
            params: { transaction: tx },
          });
          signedBase64 = fromByteArray(signedTransaction.serialize());
        } catch (err) {
          if (isUserCanceledSign(err)) {
            // A dismissed prompt is a decision. It holds the step it was asked
            // at rather than failing the send, and nothing has been signed.
            hold("paused", "You cancelled this check. Nothing has been sent.");
            setIsLoading(false);
            return;
          }
          throw err;
        }

        prepared = {
          intentId: prep.intentId,
          signedTxBase64: signedBase64,
          presenceProof,
        };
        pendingSubmission.current = prepared;
      }

      show("sending");

      let submitRes: SubmitTransferResponse;
      try {
        submitRes = await submitPrepared(prepared);
      } catch (err: any) {
        if (err?.data?.code === "INTENT_EXPIRED") {
          // The signed tx can no longer land; a fresh prepare is required.
          pendingSubmission.current = null;
          hold("failed", "This took too long. Nothing has been sent.");
          setIsLoading(false);
          return;
        }
        if (
          err?.data?.code === "PRESENCE_REQUIRED" ||
          err?.data?.code === "PRESENCE_INVALID"
        ) {
          // Refused before broadcast, so there is nothing in flight to protect
          // and no reason to keep a proof the backend has already rejected.
          // Confirm starts over, which asks for the fingerprint again.
          pendingSubmission.current = null;
          hold("failed", NOT_CONFIRMED);
          setIsLoading(false);
          return;
        }
        if (err?.data?.code === "RPC_UNAVAILABLE") {
          hold("failed", NETWORK_BUSY);
          setIsLoading(false);
          return;
        }
        // Ambiguous failure after retry: keep the signed intent so the next
        // Confirm resubmits it (idempotently) instead of re-preparing.
        throw err;
      }

      // Submitted (or deduplicated) — the intent is spent.
      pendingSubmission.current = null;

      // Refresh activity + balances so the new transfer and debited balance
      // show on return. Fire-and-forget: don't block navigation to /success.
      queryClient.invalidateQueries({ queryKey: ["transfers"] });
      queryClient.invalidateQueries({ queryKey: ["balances"] });
      // What is left of the daily limit went down with this send, and it is
      // what the amount screen warns from.
      queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY });

      if (run === attempt.current) {
        setFlow({ step: "sent", state: "done", message: null, aboveLimit });
        await new Promise((resolve) => setTimeout(resolve, SENT_DWELL_MS));
        // Closed before the push: a modal left open sits over the success
        // screen it was meant to hand off to.
        setFlow(null);
      }

      router.push({
        pathname: "/success",
        params: {
          amount,
          type,
          title,
          signature: submitRes.signature,
        },
      });
    } catch (error: any) {
      Sentry.captureException(
        new Error(`Failed to confirm payment: ${error}. (send)/confirm.tsx`)
      );
      setIsLoading(false);
      // A retained pendingSubmission means the tx may have reached the
      // backend; the next Confirm resubmits the same intent idempotently,
      // so a retry cannot double-send.
      const unresolved = pendingSubmission.current !== null;
      hold(
        "failed",
        unresolved
          ? "We could not tell whether this went through. Trying again is safe: it cannot send twice."
          : "Something went wrong. Nothing has been sent."
      );
    }
  };

  /**
   * Leaves the modal without cancelling anything. Nothing is in flight when it
   * is offered: it only appears once the send has stopped at a step.
   */
  const handleDismissFlow = () => {
    attempt.current += 1;
    setFlow(null);
    setIsLoading(false);
  };

  const handleCancel = () => {
    router.push({
      pathname: "/(tabs)",
      params: { amount, type, title },
    });
  };

  const renderInfo = (icon: IconSymbolName, label: string, value: string) => {
    const iconColor = textColor + "40";
    return (
      <View>
        <View className="mb-2 flex-row items-center gap-1">
          <IconSymbol name={icon} size={16} color={iconColor} />
          {/* DYNAMIC-COLOR */}
          <ThemedText type="regular" style={{ color: iconColor }}>
            {label}
          </ThemedText>
        </View>
        <ThemedText
          type="defaultSemiBold"
          className="text-[18px] leading-[23px]"
        >
          {value}
        </ThemedText>
      </View>
    );
  };

  return (
    <ThemedScreen
      useSafeArea={true}
      safeAreaEdges={["bottom", "left", "right"]}
    >
      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <View className="flex-1 px-6 pb-8 pt-12">
          <View className="flex-1 gap-6">
            <View className="gap-2">
              <ThemedText type="regular">Amount</ThemedText>
              <ThemedText type="jumbo">{formatAmount({ amount })}</ThemedText>
            </View>
            {renderInfo("arrow.forward", "To", recipient)}
            {/* A recipient picked from recents carries no name; an empty row
                reads as a field that failed to load. */}
            {name ? renderInfo("person", "Name", name) : null}
          </View>

          <ButtonGroup
            leftTitle="Cancel"
            leftVariant="quiet"
            rightTitle="Confirm"
            rightVariant="secondary"
            leftOnPress={handleCancel}
            rightOnPress={handleConfirm}
          />
        </View>
      )}

      <SpendCheckModal
        visible={flow !== null}
        step={flow?.step ?? "identity"}
        state={flow?.state ?? "working"}
        message={flow?.message ?? null}
        aboveDailyLimit={flow?.aboveLimit ?? false}
        heading="Sending"
        amount={`${formatAmount({ amount })} USDC`}
        counterparty={shortenAddress(recipient)}
        onRetry={handleConfirm}
        onDismiss={handleDismissFlow}
      />
    </ThemedScreen>
  );
}
