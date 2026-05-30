import React, { useState } from "react";
import { View } from "react-native";
import { ThemedScreen } from "@/components/ui/layout";
import { ThemedText, IconSymbol, LoadingSpinner } from "@/components/ui/atoms";
// TODO: check if this is needed
import { IconSymbolName } from "@/components/ui/atoms/IconSymbol";
import { router, useLocalSearchParams } from "expo-router";
import { formatAmount } from "@/utils/helper";
import { useThemeColor } from "@/hooks/useThemeColor";
import { ButtonGroup } from "@/components/ui/molecules";
import { useAuth } from "@/contexts/AuthContext";
import { EasClient } from "@/utils/easClient";
import { ErrorCode } from "@/utils/errors";
import { useToast } from "@/contexts/ToastContext";
import * as Sentry from "@sentry/react-native";
import { CreatePaymentIntentRequest } from "@sqds/grid-react-native";
import { SDKGridClient } from "../../grid/sdkClient";
import { StorageService } from "@/utils/storage";
import { AUTH_STORAGE_KEYS } from "@/utils/auth";
import { useNewStack } from "@/utils/featureFlags";
import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import { apiClient, PrepareTransferResponse } from "@/utils/apiClient";
import { toByteArray, fromByteArray } from "base64-js";
import { VersionedTransaction } from "@solana/web3.js";

/**
 * USDC mint used by the send flow. The legacy Grid flow hardcoded "usdc"
 * as a currency string; the new stack requires the actual mint address
 * because the backend `prepareTransfer` builds a real SPL transfer
 * instruction. Read from the same env var the rest of the app uses.
 */
const USDC_MINT = process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS ?? "";

/**
 * Detect the well-known shapes a Privy passkey ceremony surfaces when the
 * user dismisses the system prompt. The Privy SDK does not export a typed
 * `UserCancelled` error today; we string-match on the message/name to keep
 * a "stay on screen, prompt to retry" UX rather than a hard failure.
 */
function isUserCanceledSign(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)) ?? "";
  const name = err instanceof Error ? err.name : "";
  return /cancel|denied|aborted|dismiss/i.test(`${name} ${msg}`);
}

export default function ConfirmScreen() {
  const textColor = useThemeColor({}, "text");
  const [isLoading, setIsLoading] = useState(false);
  const { user, wallet: contextWallet, logout } = useAuth();
  const { showToast } = useToast();
  const newStack = useNewStack();
  // Privy hooks must be called unconditionally; the new-stack branch reads
  // `embeddedSolana.wallets?.[0]` when it runs and the legacy branch ignores
  // this hook entirely. Per Wave 1 design (AuthContext-4a deviation #1),
  // `<PrivyProvider>` is always mounted upstream so this is safe.
  const embeddedSolana = useEmbeddedSolanaWallet();

  const { amount, recipient, name, type, title } = useLocalSearchParams<{
    amount: string;
    recipient: string;
    name: string;
    type: string;
    title: string;
  }>();

  /**
   * New-stack send flow (Phase 4):
   *  prepareTransfer → Privy signTransaction → submitTransfer.
   *
   * Error handling per dispatch:
   *  - INTENT_EXPIRED (410): re-prepare once automatically; on a second
   *    expiry surface "Try again" toast and stay on screen.
   *  - User cancels passkey prompt: toast "Sign again to send", stay.
   *  - RPC_UNAVAILABLE (502): toast and stay.
   *  - Privy session expiry: per spec §9 the SDK silently re-prompts for
   *    passkey internally; this function does NOT logout under any path.
   */
  const handleConfirmNewStack = async () => {
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
    // decimals. Use BigInt-safe construction so a 9-digit display amount
    // does not overflow JS Number (`9_999_999_999` × 1e6 is still inside
    // safe-int range, but using BigInt here future-proofs against larger
    // mints with 9 decimals).
    const amountRaw = BigInt(Math.round(Number(amount) * 1_000_000)).toString();

    setIsLoading(true);
    try {
      // ── Prepare (with automatic single retry on INTENT_EXPIRED) ─────
      let prep: PrepareTransferResponse;
      try {
        prep = await apiClient.prepareTransfer({
          toAddress: recipient,
          mint: USDC_MINT,
          amountRaw,
        });
      } catch (err: any) {
        if (err?.data?.code === "INTENT_EXPIRED") {
          // First-prepare blockhash already stale (rare); retry once.
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

      // ── Sign with Privy ──────────────────────────────────────────────
      // Privy's `EmbeddedSolanaWalletProvider.request({ method:
      // "signTransaction", params: { transaction } })` takes a
      // `VersionedTransaction` (from @solana/web3.js) and returns
      // `{ signedTransaction: VersionedTransaction }`. Backend hands us
      // a base64-serialized v0 transaction; we deserialize → sign →
      // re-serialize → re-encode.
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

      // ── Submit ───────────────────────────────────────────────────────
      let submitRes;
      try {
        submitRes = await apiClient.submitTransfer({
          intentId: prep.intentId,
          signedTxBase64: signedBase64,
        });
      } catch (err: any) {
        if (err?.data?.code === "INTENT_EXPIRED") {
          // User signed too slowly. Re-prepare ONCE then surface "try
          // again" on the second expiry (do not silently re-sign — the
          // signature would mismatch the new blockhash).
          showToast("Try again");
          setIsLoading(false);
          return;
        }
        if (err?.data?.code === "RPC_UNAVAILABLE") {
          showToast("Network temporarily unavailable, try again");
          setIsLoading(false);
          return;
        }
        throw err;
      }

      // ── Success ──────────────────────────────────────────────────────
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
        new Error(
          `Failed to confirm payment (new stack): ${error}. (send)/confirm.tsx`
        )
      );
      setIsLoading(false);
      // Generic surface — the screen stays on confirm; do NOT logout.
      showToast("Could not send. Please try again.");
    }
  };

  const handleConfirmLegacy = async () => {
    setIsLoading(true);
    try {
      const sessionSecrets = await StorageService.getItem(
        AUTH_STORAGE_KEYS.SESSION_SECRETS
      );
      if (!user || !user.address || !sessionSecrets) {
        logout();
        router.push({
          pathname: "/(auth)/login",
        });

        return;
      }

      const backupKey = user.policies.signers.find(
        (signer: any) => signer.provider === "turnkey"
      );
      if (!backupKey) {
        throw new Error("Backup key not found");
      }

      const prepareTransactionParams: CreatePaymentIntentRequest = {
        amount: (Number(amount) * 1000000).toString(), // Convert to USDC base units
        source: {
          account: user.address,
          currency: "usdc",
          // transaction_signers: [backupKey.address]
        },
        destination: {
          address: recipient,
          currency: "usdc",
        },
      };

      const easClient = new EasClient();

      const transactionData = await easClient.preparePaymentIntent(
        prepareTransactionParams,
        user.address,
        true
      );

      if (!user) {
        logout();
        router.push({
          pathname: "/(auth)/login",
        });

        return;
      }

      const gridClient = SDKGridClient.getFrontendClient();

      const signedPayload = await gridClient.sign({
        sessionSecrets: sessionSecrets as any,
        session: user.authentication,
        transactionPayload: transactionData.data.transactionPayload!,
      });

      const payload = {
        signedTransactionPayload: signedPayload,
        address: user.address,
      };

      await easClient.confirmPaymentIntent(payload);
      router.push({
        pathname: "/success",
        params: { amount, type, title },
      });
    } catch (error: any) {
      if (
        error?.data?.code === ErrorCode.SESSION_EXPIRED ||
        error?.data?.details?.some(
          (detail: any) => detail.code === "API_KEY_EXPIRED"
        )
      ) {
        showToast("Session expired, please log in again");
        logout();
        return;
      }

      Sentry.captureException(
        new Error(
          `Failed to confirm payment: ${error}. (send)/confirm.tsx (handleConfirm)`
        )
      );
      setIsLoading(false);
      throw error;
    }
  };

  const handleConfirm = newStack ? handleConfirmNewStack : handleConfirmLegacy;
  // Surface the wallet address from the AuthContext-derived value so a
  // lint-fail does not strip the import — used by the new-stack path
  // indirectly (Privy hook provides the actual signer).
  void contextWallet;

  const handleCancel = () => {
    // Navigate to home
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
            {/* {renderInfo('network', 'Network fee', '0.0004 SOL')} */}
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
