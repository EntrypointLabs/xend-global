import React from "react";
import { ActivityIndicator, Modal, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";

import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { formatAmount } from "@/utils/helper";
import { cn } from "@/utils/cn";

/**
 * Where the send has got to. Each one is a place the code actually reaches, so
 * the Consumer is never shown progress that has not happened.
 */
export type AboveLimitSendStep =
  | "reason"
  | "identity"
  | "approval"
  | "sending"
  | "sent";

/**
 * `paused` is the Consumer dismissing a prompt: a decision, not a fault, so it
 * holds position on the step instead of failing the send.
 */
export type AboveLimitSendState = "working" | "paused" | "failed" | "done";

interface AboveLimitSendModalProps {
  visible: boolean;
  step: AboveLimitSendStep;
  state: AboveLimitSendState;
  /** Decimal string, as typed on the amount screen. */
  amount: string;
  recipient: string | undefined;
  /** Shown in place of the step's own line when it is paused or failed. */
  message: string | null;
  /** False for an Account with no limit yet, where every send is checked twice. */
  aboveDailyLimit: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}

/**
 * The send that takes two confirmations, given its own screen.
 *
 * A dark full screen rather than the app's usual card because this is the only
 * moment a Consumer is asked for two prompts in a row, and the previous version
 * of it, a spinner and a toast, was indistinguishable from an ordinary send
 * right up until the second prompt appeared with nothing to explain it.
 *
 * The mechanism is deliberately not the story: nothing here mentions signers,
 * thresholds or policies. What a Consumer needs is that a larger amount is
 * checked twice, and which check they are being asked for now.
 */
export function AboveLimitSendModal({
  visible,
  step,
  state,
  amount,
  recipient,
  message,
  aboveDailyLimit,
  onRetry,
  onDismiss,
}: AboveLimitSendModalProps) {
  const current = STEP_ORDER.indexOf(step);
  const settled = state === "paused" || state === "failed";
  const finished = step === "sent";
  const steps = stepsFor(aboveDailyLimit);

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent>
      <StatusBar style="light" />
      {/* Fixed dark, not the app's theme: this screen is the same weight
          whichever theme the Consumer runs. The values are the dark palette's
          own, so it still reads as this app in either. */}
      <SafeAreaView edges={["top", "bottom"]} className="flex-1 bg-black">
        <View className="flex-1 px-6 pb-8 pt-6">
          <Typography weight="500" className="text-white/50">
            Sending
          </Typography>
          <Typography weight="700" variant="h3" className="mt-1 text-white">
            {formatAmount({ amount })} USDC
          </Typography>
          <Typography weight="400" className="mt-1 text-white/50">
            to {shorten(recipient)}
          </Typography>

          <View className="my-8 h-px bg-white/10" />

          <View className="flex-1">
            {steps.map((row, index) => {
              const reached = index === current;
              return (
                <Step
                  key={row.key}
                  title={finished && row.key === "sending" ? "Sent" : row.title}
                  body={
                    reached && settled && message
                      ? message
                      : finished && row.key === "sending"
                        ? "The money is on its way."
                        : row.body
                  }
                  position={
                    index < current
                      ? "done"
                      : reached
                        ? settled
                          ? state
                          : "active"
                        : "waiting"
                  }
                  last={index === steps.length - 1}
                />
              );
            })}
          </View>

          {settled ? (
            <View className="gap-3">
              <HapticPressable
                onPress={onRetry}
                className="w-full items-center justify-center rounded-full bg-white py-4"
              >
                <Typography weight="600" className="text-base text-black">
                  Try again
                </Typography>
              </HapticPressable>
              <HapticPressable
                onPress={onDismiss}
                feedback="selection"
                className="w-full items-center justify-center py-3"
              >
                <Typography weight="500" className="text-sm text-white/50">
                  Not now
                </Typography>
              </HapticPressable>
            </View>
          ) : finished ? null : (
            // No way out while a prompt or the network has the send. Offering
            // one would suggest the send can be called back, and once it is
            // signed it cannot.
            <Typography
              weight="400"
              className="text-center text-sm text-white/40"
            >
              Keep the app open until this finishes.
            </Typography>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

/** Where this row sits relative to the step the send has reached. */
type StepPosition = "done" | "active" | "paused" | "failed" | "waiting";

function Step({
  title,
  body,
  position,
  last,
}: {
  title: string;
  body: string;
  position: StepPosition;
  last: boolean;
}) {
  const failed = position === "failed";
  const dim = position === "waiting";

  return (
    <View className="flex-row">
      <View className="w-6 items-center">
        <View
          className={cn(
            "h-6 w-6 items-center justify-center rounded-full",
            position === "done" && "bg-success",
            position === "failed" && "bg-destructive",
            position === "active" && "border border-white",
            position === "paused" && "border border-white/60",
            position === "waiting" && "border border-white/20"
          )}
        >
          {position === "done" ? (
            <Ionicons name="checkmark" size={14} color="#000" />
          ) : failed ? (
            <Ionicons name="close" size={14} color="#fff" />
          ) : (
            <View
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                position === "waiting" ? "bg-white/20" : "bg-white"
              )}
            />
          )}
        </View>
        {!last && (
          <View
            className={cn(
              "my-1 w-px flex-1",
              position === "done" ? "bg-success/50" : "bg-white/10"
            )}
          />
        )}
      </View>

      <View
        className={cn(
          "flex-1 flex-row items-start gap-3 pb-7 pl-4",
          dim && "opacity-40"
        )}
      >
        <View className="flex-1">
          <Typography weight="600" className="text-base text-white">
            {title}
          </Typography>
          <Typography
            weight="400"
            className={cn(
              "mt-1 text-sm leading-5",
              failed ? "text-destructive" : "text-white/50"
            )}
          >
            {body}
          </Typography>
        </View>
        {position === "active" && <ActivityIndicator color="#fff" />}
      </View>
    </View>
  );
}

type StepCopy = { key: AboveLimitSendStep; title: string; body: string };

/**
 * An Account that has not finished being set up has no limit to be over, so
 * the first step says why the checks are happening without naming one.
 */
function stepsFor(aboveDailyLimit: boolean): StepCopy[] {
  return [
    aboveDailyLimit
      ? {
          key: "reason",
          title: "Above your daily limit",
          body: "Larger amounts are checked twice, so nobody who picks up your phone can empty your account.",
        }
      : {
          key: "reason",
          title: "This one takes two checks",
          body: "Two checks mean nobody who picks up your phone can empty your account.",
        },
    ...REMAINING_STEPS,
  ];
}

const REMAINING_STEPS: StepCopy[] = [
  {
    key: "identity",
    title: "Check it is you",
    body: "Your phone asks for your face or your fingerprint.",
  },
  {
    key: "approval",
    title: "Approve on this phone",
    body: "The second check, done by your wallet.",
  },
  {
    key: "sending",
    title: "Sending",
    body: "Handing the payment to the network.",
  },
];

/** `sent` is the last row finished rather than a row of its own. */
const STEP_ORDER: AboveLimitSendStep[] = [
  "reason",
  "identity",
  "approval",
  "sending",
  "sent",
];

/**
 * Tolerates a missing address because it is fed from router params, which are
 * typed as strings and are not guaranteed to be there. `Modal` renders its
 * children whether or not it is visible, so an absent recipient took the whole
 * confirm screen down rather than just this line.
 */
function shorten(address: string | undefined): string {
  if (!address) return "";
  return address.length > 12
    ? `${address.slice(0, 4)}...${address.slice(-4)}`
    : address;
}
