import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useReducedMotion } from "react-native-reanimated";

import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { HoldToApprove } from "@/components/payment-approval/HoldToApprove";
import type {
  ApprovalPhase,
  ApprovalStep,
} from "@/hooks/usePaymentApprovalFlow";
import type { AwaitingPayment } from "@/utils/apiClient";
import { formatMoney } from "@/utils/money";
import { cn } from "@/utils/cn";

const INK = "#0E0F0C";
const DISPLAY = { fontFamily: "Montserrat_900Black" } as const;
/** Under a minute, the countdown is the most important thing on the screen. */
const URGENT_MS = 60_000;

const STEP_LABEL: Record<ApprovalStep, string> = {
  preparing: "Getting it ready",
  device: "Confirm with your device key",
  sending: "Sending",
  confirming: "Confirming",
};

function useCountdown(expiresAt: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Date.parse(expiresAt) - now);
  const minutes = Math.floor(left / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  return {
    left,
    label: `${minutes}:${seconds.toString().padStart(2, "0")}`,
  };
}

/** Rises in on mount; the settled states spring their mark in. */
function useEntrance(reduceMotion: boolean) {
  const value = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(value, {
      toValue: 1,
      duration: 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [reduceMotion, value]);
  return {
    opacity: value,
    transform: [
      {
        translateY: value.interpolate({
          inputRange: [0, 1],
          outputRange: [28, 0],
        }),
      },
    ],
  };
}

function Outcome({
  tone,
  title,
  message,
  onDone,
}: {
  tone: "success" | "neutral";
  title: string;
  message: string;
  onDone: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const mark = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.spring(mark, {
      toValue: 1,
      speed: 14,
      bounciness: 9,
      useNativeDriver: true,
    }).start();
  }, [mark, reduceMotion]);

  return (
    <View className="flex-1 px-6">
      <View className="flex-1 items-center justify-center">
        <Animated.View
          className={cn(
            "size-24 items-center justify-center rounded-full",
            tone === "success" ? "bg-success" : "bg-black/[0.06]"
          )}
          style={{ opacity: mark, transform: [{ scale: mark }] }}
        >
          <Ionicons
            name={tone === "success" ? "checkmark" : "close"}
            size={48}
            color={tone === "success" ? "#fff" : INK}
          />
        </Animated.View>
        <Typography
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          className="mt-8 text-center text-[34px] uppercase leading-[34px] tracking-[-1px] text-[#0E0F0C]"
          style={DISPLAY}
        >
          {title}
        </Typography>
        <Typography
          weight="500"
          className="mt-3 max-w-[300px] text-center text-[15px] leading-[21px] text-black/60"
        >
          {message}
        </Typography>
      </View>
      <HapticPressable
        onPress={onDone}
        accessibilityRole="button"
        className="mb-2 h-16 w-full items-center justify-center rounded-full bg-black/[0.06]"
      >
        <Typography weight="600" className="text-[16px] text-[#0E0F0C]">
          Done
        </Typography>
      </HapticPressable>
    </View>
  );
}

function Detail({
  label,
  value,
  urgent,
}: {
  label: string;
  value: string;
  urgent?: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between py-3.5">
      <Typography weight="500" className="text-[14px] text-black/60">
        {label}
      </Typography>
      <View
        className={cn(
          "rounded-full",
          urgent && "-mr-2.5 bg-destructive/15 px-2.5 py-1"
        )}
      >
        <Typography
          weight="600"
          className="text-[14px] tabular-nums text-[#0E0F0C]"
        >
          {value}
        </Typography>
      </View>
    </View>
  );
}

/**
 * The whole screen, for one Payment a checkout is waiting on.
 *
 * Built to be answered in a few seconds by someone standing at a till: who is
 * asking and how much, in type large enough to read at arm's length, a hold to
 * approve that cannot happen by accident, and a way to say no that tells the
 * checkout straight away.
 */
export function PaymentApprovalTakeover({
  payment,
  phase: flowPhase,
  onApprove,
  onDecline,
  onLater,
  onClose,
}: {
  payment: AwaitingPayment;
  phase: ApprovalPhase;
  onApprove: () => void;
  onDecline: () => void;
  /** Close without answering; the Payment keeps waiting. */
  onLater: () => void;
  /** Close after an answer. */
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const entrance = useEntrance(reduceMotion);
  // From the provider, not a measuring SafeAreaView: inside the window overlay
  // that one measures zero whenever a native modal is up.
  const insets = useSafeAreaInsets();
  const { left, label: countdown } = useCountdown(payment.expiresAt);
  const phase: ApprovalPhase =
    flowPhase.kind === "idle" && left <= 0
      ? {
          kind: "problem",
          tone: "failed",
          title: "This quote expired",
          message: "Nothing was paid. Head back to the store for a new one.",
          canRetry: false,
        }
      : flowPhase;
  const amount = formatMoney(
    payment.displayCurrency,
    payment.displayAmountMinor
  );
  const usdc = formatMoney("USDC", payment.usdcSettlementRaw);
  const merchant = payment.merchantDisplayName;
  const busy = phase.kind === "working" || phase.kind === "declining";
  const answered = phase.kind === "succeeded" || phase.kind === "declined";

  const signal =
    phase.kind === "problem" ? `problem:${phase.tone}` : phase.kind;
  const lastSignal = useRef(signal);
  useEffect(() => {
    if (lastSignal.current === signal) return;
    lastSignal.current = signal;
    if (signal === "succeeded")
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (signal === "declined")
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    if (signal === "problem:failed")
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }, [signal]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (busy) return true;
      if (answered) onClose();
      else onLater();
      return true;
    });
    return () => sub.remove();
  }, [answered, busy, onClose, onLater]);

  return (
    <View
      className="absolute inset-0 bg-white"
      accessibilityViewIsModal
      importantForAccessibility="yes"
    >
      <View
        className="flex-1"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        {phase.kind === "succeeded" ? (
          <Outcome
            tone="success"
            title="Paid"
            message={`${amount} to ${merchant}. The checkout will update on its own.`}
            onDone={onClose}
          />
        ) : phase.kind === "declined" ? (
          <Outcome
            tone="neutral"
            title="Declined"
            message={`Nothing was paid. The ${merchant} checkout will show it was declined.`}
            onDone={onClose}
          />
        ) : (
          <Animated.View className="flex-1 px-6" style={entrance}>
            <View className="h-14 flex-row items-center justify-between">
              <View className="flex-row items-center gap-2 rounded-full bg-black/[0.05] px-3 py-1.5">
                <View className="size-2 rounded-full bg-success" />
                <Typography weight="600" className="text-[13px] text-[#0E0F0C]">
                  Waiting at checkout
                </Typography>
              </View>
              <HapticPressable
                onPress={onLater}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Decide later"
                hitSlop={8}
                className={cn(
                  "size-10 items-center justify-center rounded-full bg-black/[0.05]",
                  busy && "opacity-30"
                )}
              >
                <Ionicons name="close" size={20} color={INK} />
              </HapticPressable>
            </View>

            <View className="flex-1 justify-center">
              <View className="size-16 items-center justify-center rounded-[20px] bg-[#0E0F0C]">
                <Typography
                  className="text-[28px] uppercase leading-[30px] text-white"
                  style={DISPLAY}
                >
                  {merchant.trim().charAt(0) || "P"}
                </Typography>
              </View>
              <Typography
                weight="600"
                className="mt-6 text-[17px] text-[#0E0F0C]"
              >
                {merchant} is asking for
              </Typography>
              <Typography
                accessibilityRole="header"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
                className="mt-1 text-[56px] leading-[60px] tracking-[-2px] text-[#0E0F0C]"
                style={DISPLAY}
              >
                {amount}
              </Typography>
              <Typography
                weight="500"
                className="mt-1 text-[14px] tabular-nums text-black/60"
              >
                {usdc} leaves your Account
              </Typography>

              <View className="mt-8 border-t border-black/[0.07]">
                {payment.merchantReference ? (
                  <Detail label="For" value={payment.merchantReference} />
                ) : null}
                <Detail
                  label="Quote holds for"
                  value={left > 0 ? countdown : "Expired"}
                  urgent={left < URGENT_MS}
                />
                <Detail label="Checked by" value="Passkey and device key" />
              </View>
            </View>

            {phase.kind === "problem" ? (
              <View
                accessibilityLiveRegion="polite"
                className={cn(
                  "mb-4 flex-row gap-3 rounded-2xl p-4",
                  phase.tone === "failed"
                    ? "bg-destructive/10"
                    : "bg-black/[0.05]"
                )}
              >
                <Ionicons
                  name={
                    phase.tone === "failed"
                      ? "alert-circle"
                      : "information-circle"
                  }
                  size={20}
                  color={INK}
                />
                <View className="flex-1">
                  <Typography
                    weight="600"
                    className="text-[15px] text-[#0E0F0C]"
                  >
                    {phase.title}
                  </Typography>
                  <Typography
                    weight="500"
                    className="mt-0.5 text-[13px] leading-[18px] text-black/70"
                  >
                    {phase.message}
                  </Typography>
                </View>
              </View>
            ) : null}

            <View className="mb-2 gap-2">
              {busy ? (
                <View
                  accessibilityLiveRegion="polite"
                  className="h-16 w-full flex-row items-center justify-center gap-3 rounded-full bg-[#0E0F0C]"
                >
                  <ActivityIndicator color="#fff" />
                  <Typography weight="600" className="text-[16px] text-white">
                    {phase.kind === "working"
                      ? STEP_LABEL[phase.step]
                      : "Declining"}
                  </Typography>
                </View>
              ) : phase.kind === "problem" && !phase.canRetry ? (
                <HapticPressable
                  onPress={onClose}
                  accessibilityRole="button"
                  className="h-16 w-full items-center justify-center rounded-full bg-[#0E0F0C]"
                >
                  <Typography weight="600" className="text-[16px] text-white">
                    Close
                  </Typography>
                </HapticPressable>
              ) : (
                <HoldToApprove
                  label={
                    phase.kind === "problem"
                      ? "Hold to try again"
                      : "Hold to approve"
                  }
                  onApprove={onApprove}
                  disabled={left <= 0}
                />
              )}
              {!busy && !(phase.kind === "problem" && !phase.canRetry) ? (
                <HapticPressable
                  onPress={onDecline}
                  accessibilityRole="button"
                  accessibilityLabel={`Decline ${amount} to ${merchant}`}
                  className="h-14 w-full items-center justify-center rounded-full"
                >
                  <Typography
                    weight="600"
                    className="text-[16px] text-[#0E0F0C]"
                  >
                    Decline
                  </Typography>
                </HapticPressable>
              ) : (
                <View className="h-14" />
              )}
            </View>
          </Animated.View>
        )}
      </View>
    </View>
  );
}
