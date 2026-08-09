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
import { useToast } from "@/contexts/ToastContext";
import * as Sentry from "@sentry/react-native";
import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import {
  apiClient,
  PrepareTransferResponse,
  SubmitTransferResponse,
} from "@/utils/apiClient";
import { toByteArray, fromByteArray } from "base64-js";
import { VersionedTransaction } from "@solana/web3.js";

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
type PendingSubmission = { intentId: string; signedTxBase64: string };

export default function ConfirmScreen() {
  const textColor = useThemeColor({}, "text");
  const [isLoading, setIsLoading] = useState(false);
  const { showToast } = useToast();
  const embeddedSolana = useEmbeddedSolanaWallet();
  const queryClient = useQueryClient();
  const pendingSubmission = useRef<PendingSubmission | null>(null);

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
   * Send flow: prepareTransfer → Privy signTransaction → submitTransfer.
   *
   * Error handling:
   *  - INTENT_EXPIRED (410) from prepare: re-prepare once automatically.
   *  - INTENT_EXPIRED (410) from submit: surface "Try again" toast; stay
   *    on screen (do NOT silently re-sign — signature would mismatch the
   *    new blockhash).
   *  - User cancels passkey prompt: toast "Sign again to send", stay.
   *  - RPC_UNAVAILABLE (502): toast and stay.
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
      showToast("Wallet not ready, please try again");
      return;
    }

    // USDC has 6 decimals; backend wants the integer string at native
    // decimals. BigInt-safe construction future-proofs against larger
    // mints with 9 decimals.
    const amountRaw = BigInt(Math.round(Number(amount) * 1_000_000)).toString();

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
            showToast("Network temporarily unavailable, try again");
            setIsLoading(false);
            return;
          } else {
            throw err;
          }
        }

        let signedBase64: string;
        try {
          const provider = await embeddedWallet.getProvider();
          const txBytes = toByteArray(prep.unsignedTxBase64);
          const tx = VersionedTransaction.deserialize(txBytes);
          const { signedTransaction } = await provider.request({
            method: "signTransaction",
            params: { transaction: tx },
          });
          signedBase64 = fromByteArray(signedTransaction.serialize());
        } catch (err) {
          if (isUserCanceledSign(err)) {
            showToast("Sign again to send");
            setIsLoading(false);
            return;
          }
          throw err;
        }

        prepared = { intentId: prep.intentId, signedTxBase64: signedBase64 };
        pendingSubmission.current = prepared;
      }

      let submitRes: SubmitTransferResponse;
      try {
        submitRes = await submitPrepared(prepared);
      } catch (err: any) {
        if (err?.data?.code === "INTENT_EXPIRED") {
          // The signed tx can no longer land; a fresh prepare is required.
          pendingSubmission.current = null;
          showToast("Try again");
          setIsLoading(false);
          return;
        }
        if (err?.data?.code === "RPC_UNAVAILABLE") {
          showToast("Network temporarily unavailable, try again");
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
      showToast(
        pendingSubmission.current
          ? "Send may not have completed. Tap Confirm to retry safely."
          : "Could not send. Please try again."
      );
    }
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
            {renderInfo("person", "Name", name)}
          </View>

          <ButtonGroup
            leftTitle="Cancel"
            leftVariant="secondary"
            rightTitle="Confirm"
            rightVariant="primary"
            leftOnPress={handleCancel}
            rightOnPress={handleConfirm}
          />
        </View>
      )}
    </ThemedScreen>
  );
}
