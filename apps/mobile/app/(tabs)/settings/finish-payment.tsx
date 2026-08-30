import React, { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { Buffer } from "buffer";
import { useQueryClient } from "@tanstack/react-query";
import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import { Ionicons } from "@expo/vector-icons";
import { toByteArray, fromByteArray } from "base64-js";
import { VersionedTransaction } from "@solana/web3.js";
import * as Sentry from "@sentry/react-native";

import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import {
  SpendCheckModal,
  type SpendCheckState,
  type SpendCheckStep,
} from "@/components/ui/organisms/modals/SpendCheckModal";
import { ACCOUNT_QUERY_KEY, useAccount } from "@/hooks/useAccount";
import {
  AWAITING_PAYMENTS_KEY,
  useAwaitingPayments,
} from "@/hooks/useAwaitingPayments";
import { SIGN_PROMPT } from "@/modules/hardware-key/src";
import { signWithApprovalSigner } from "@/modules/hardware-key/src/turnkeySign";
import { useToast } from "@/contexts/ToastContext";
import { apiClient, type AwaitingPayment } from "@/utils/apiClient";
import { formatMoney } from "@/utils/money";
import { isUserCanceledSign } from "@/utils/signing";

type Flow = {
  step: SpendCheckStep;
  state: SpendCheckState;
  message: string | null;
};

/**
 * How long "Sent" stays up before the Activity feed replaces it.
 *
 * The Payment is real by the time this runs; the pause only makes the last tick
 * legible after two prompts, which is the point of showing the steps at all.
 */
const SENT_DWELL_MS = 700;

/**
 * Finishing a Payment a checkout could not.
 *
 * "Pay with Xend" on a merchant page reaches one of the Account's signers. A
 * Payment larger than that signer carries alone needs the second, which lives
 * on this phone, so the checkout hands it over rather than failing it. Nothing
 * has been charged when someone arrives here.
 *
 * Both signatures are produced here, in one transaction, rather than the
 * checkout collecting one and this adding the other: a Spend is bound to a
 * single blockhash and would be dead long before anyone reached their phone.
 */
export default function FinishPaymentScreen() {
  const { data: payments, isLoading, isError, refetch } = useAwaitingPayments();
  const { data: account } = useAccount();
  const embeddedSolana = useEmbeddedSolanaWallet();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [flow, setFlow] = useState<Flow | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  // State rather than a ref: the modal reads it while rendering, and a ref
  // would show the previous Payment's merchant and amount for one frame.
  const [active, setActive] = useState<AwaitingPayment | null>(null);

  const waiting = payments ?? [];

  const approve = async (payment: AwaitingPayment) => {
    setActive(payment);
    const embeddedWallet = embeddedSolana.wallets?.[0];
    if (!embeddedWallet) {
      showToast("Your Account is not ready yet, please try again");
      return;
    }

    let at: SpendCheckStep = "reason";
    const show = (step: SpendCheckStep) => {
      at = step;
      setFlow({ step, state: "working", message: null });
    };
    const hold = (state: "paused" | "failed", message: string) => {
      setFlow({ step: at, state, message });
    };

    show("reason");
    setPaying(payment.reference);
    try {
      const prepared = await apiClient.preparePayment(payment.reference);

      let tx = VersionedTransaction.deserialize(
        toByteArray(prepared.unsignedTxBase64)
      );

      // The approval signer goes first. Turnkey evaluates the payload it is
      // handed and its activity is unsigned in, signed out rather than
      // additive, so the primary would lose its signature if it went first.
      if (prepared.needsApprovalSignature) {
        if (!account) throw new Error("Account not loaded");
        show("identity");
        const signedHex = await signWithApprovalSigner({
          organizationId: account.approvalSubOrgId,
          signWith: account.signers.approval,
          unsignedTransaction: Buffer.from(
            toByteArray(prepared.unsignedTxBase64)
          ).toString("hex"),
          prompt: SIGN_PROMPT.payment,
        });
        tx = VersionedTransaction.deserialize(Buffer.from(signedHex, "hex"));
      }

      // The primary signs from a session and asks the Consumer for nothing, so
      // it goes under Sending rather than getting a step of its own.
      show("sending");
      const provider = await embeddedWallet.getProvider();
      const { signedTransaction } = await provider.request({
        method: "signTransaction",
        params: { transaction: tx },
      });

      await apiClient.submitPayment(
        payment.reference,
        fromByteArray(signedTransaction.serialize())
      );

      // The Payment leaves this list and arrives in Activity as a Payment of
      // its own. Balances and the daily allowance moved with it. The transfer
      // row is written when the chain confirms, a moment after this, so the
      // feed's own head watch is what actually brings it in; these only make
      // sure nothing stale is sitting in front of it.
      void queryClient.invalidateQueries({ queryKey: AWAITING_PAYMENTS_KEY });
      void queryClient.invalidateQueries({ queryKey: ["transfers"] });
      void queryClient.invalidateQueries({ queryKey: ["balances"] });
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY });

      setFlow({ step: "sent", state: "done", message: null });
      await new Promise((resolve) => setTimeout(resolve, SENT_DWELL_MS));
      // Closed before the push: a modal left open sits over the screen it was
      // meant to hand off to.
      setFlow(null);
      // Landed on Activity rather than back here, because the confirmation is
      // the thing they are waiting to see and this screen is now empty.
      router.replace("/(tabs)/history" as never);
    } catch (err) {
      if (isUserCanceledSign(err)) {
        // A dismissed prompt is a decision, not a fault. Nothing has been
        // signed, and the Payment is still waiting.
        hold("paused", "You cancelled this check. Nothing has been paid.");
        return;
      }
      Sentry.captureException(err);
      hold("failed", "That did not go through. Nothing has been paid.");
    } finally {
      setPaying(null);
    }
  };

  const retry = () => {
    if (active) void approve(active);
  };

  return (
    <ScreenLayout>
      <View className="flex-1">
        <Typography weight="700" className="mt-6 text-3xl text-black">
          Finish your payment
        </Typography>
        <Typography
          weight="500"
          className="mt-2 text-base leading-6 text-black/40"
        >
          Payments this size are checked twice.{"\n"}The second check happens
          here.
        </Typography>

        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : isError ? (
          <View className="flex-1 items-center justify-center">
            <Typography weight="500" className="mb-3 text-base text-black/40">
              Couldn&apos;t load your payments.
            </Typography>
            <HapticPressable onPress={() => refetch()} className="p-2">
              <Typography weight="600" className="text-base text-black">
                Retry
              </Typography>
            </HapticPressable>
          </View>
        ) : waiting.length === 0 ? (
          <View className="flex-1 items-center justify-center">
            <View className="mb-4 h-14 w-24 items-center justify-center rounded-full border-2 border-dashed border-black/15 bg-black/[0.03]">
              <Ionicons name="checkmark" size={22} color="#00000033" />
            </View>
            <Typography weight="700" className="text-lg text-black">
              Nothing waiting
            </Typography>
            <Typography weight="500" className="mt-1 text-base text-black/40">
              Payments needing a second check appear here.
            </Typography>
          </View>
        ) : (
          <View className="mt-8 flex-1 gap-3">
            {waiting.map((payment) => (
              <View
                key={payment.reference}
                className="rounded-[20px] border border-black/[0.05] bg-white p-4"
              >
                <Typography weight="500" className="text-sm text-black/40">
                  {payment.merchantDisplayName}
                </Typography>
                <Typography
                  weight="700"
                  className="mt-1 text-3xl tabular-nums text-black"
                >
                  {formatMoney(
                    payment.displayCurrency,
                    payment.displayAmountMinor
                  )}
                </Typography>
                <HapticPressable
                  onPress={() => void approve(payment)}
                  disabled={paying !== null}
                  className="mt-4 w-full items-center justify-center rounded-full bg-black py-4"
                >
                  <Typography weight="600" className="text-base text-white">
                    {paying === payment.reference ? "Paying" : "Pay"}
                  </Typography>
                </HapticPressable>
              </View>
            ))}
          </View>
        )}

        <View className="flex-row items-center justify-between">
          <HapticPressable
            onPress={() => router.back()}
            className="h-14 w-14 items-center justify-center rounded-full bg-white shadow-md shadow-black/10"
          >
            <Ionicons name="chevron-back" size={22} color="#000" />
          </HapticPressable>
        </View>
      </View>

      <SpendCheckModal
        visible={flow !== null}
        step={flow?.step ?? "reason"}
        state={flow?.state ?? "working"}
        message={flow?.message ?? null}
        // Always: a Payment only reaches this screen because it was above the
        // band Checkout's one signature carries, which is the same reason the
        // Account approves it alongside the Consumer.
        aboveDailyLimit
        heading="Paying"
        amount={
          active
            ? formatMoney(active.displayCurrency, active.displayAmountMinor)
            : ""
        }
        counterparty={active?.merchantDisplayName ?? ""}
        onRetry={retry}
        onDismiss={() => setFlow(null)}
      />
    </ScreenLayout>
  );
}
