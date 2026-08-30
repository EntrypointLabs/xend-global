import React from "react";
import { ActivityIndicator, Modal, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";

import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { cn } from "@/utils/cn";

/**
 * Where the Spend has got to. Each one is a place the code actually reaches, so
 * the Consumer is never shown progress that has not happened.
 *
 * There is no step for the primary signature. It is produced from a session
 * rather than from anything the Consumer does, so a row for it sat on screen
 * describing a check nobody was being asked for.
 */
export type SpendCheckStep = "reason" | "identity" | "sending" | "sent";

/**
 * `paused` is the Consumer dismissing a prompt: a decision, not a fault, so it
 * holds position on the step instead of failing the send.
 */
export type SpendCheckState = "working" | "paused" | "failed" | "done";

interface SpendCheckModalProps {
  visible: boolean;
  step: SpendCheckStep;
  state: SpendCheckState;
  /** What is happening, in the Consumer's words: "Sending", "Paying". */
  heading: string;
  /** Already formatted for display, including its currency or token. */
  amount: string;
  /** Who is being paid, already shortened or named by the caller. */
  counterparty: string;
  /** Shown in place of the step's own line when it is paused or failed. */
  message: string | null;
  /**
   * Whether the Account is approving this one as well as the Consumer. Adds the
   * row that says why; the check the Consumer performs is the same either way.
   */
  aboveDailyLimit: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}

/**
 * A Spend in progress, given its own screen.
 *
 * A dark full screen rather than the app's usual card because a Spend is the
 * moment money leaves, and it is worth reading. The version this replaced was a
 * spinner and a toast, which said nothing about the prompt that was about to
 * appear over it.
 *
 * Shown for every Spend, not only the large ones. Every Spend now asks the
 * Consumer for exactly one thing, so a screen reserved for the large ones would
 * make the ordinary case the unexplained one.
 *
 * Shared by a Send and by a Payment finished here after a checkout could not:
 * the amount and who is being paid differ, and the moment does not, so a second
 * copy of this would drift from it the first time either was touched.
 *
 * The mechanism is deliberately not the story: nothing here mentions signers,
 * thresholds or policies. What a Consumer needs is that Xend checked it was
 * them, and where the money has got to.
 */
export function SpendCheckModal({
  visible,
  step,
  state,
  heading,
  amount,
  counterparty,
  message,
  aboveDailyLimit,
  onRetry,
  onDismiss,
}: SpendCheckModalProps) {
  const steps = stepsFor(aboveDailyLimit);
  const settled = state === "paused" || state === "failed";
  const finished = step === "sent";
  // Located in the rendered rows rather than in a fixed order, because the
  // reason row is absent under the limit and an index into a list that is not
  // on screen puts the tick on the wrong line. `sent` sits past the last row so
  // every one of them reads as done; a step with no row of its own falls to the
  // first, which is where the send has got to.
  const found = steps.findIndex((row) => row.key === step);
  const current = finished ? steps.length : found < 0 ? 0 : found;

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent>
      <StatusBar style="light" />
      {/* Fixed dark, not the app's theme: this screen is the same weight
          whichever theme the Consumer runs. The values are the dark palette's
          own, so it still reads as this app in either. */}
      <SafeAreaView edges={["top", "bottom"]} className="flex-1 bg-black">
        <View className="flex-1 px-6 pb-8 pt-6">
          <Typography weight="500" className="text-white/50">
            {heading}
          </Typography>
          <Typography weight="700" variant="h3" className="mt-1 text-white">
            {amount}
          </Typography>
          <Typography weight="400" className="mt-1 text-white/50">
            to {counterparty}
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

type StepCopy = { key: SpendCheckStep; title: string; body: string };

/**
 * Above the limit the Account approves the Spend alongside the Consumer. That
 * costs them nothing extra to do, so it is stated as a fact about the amount
 * rather than as a step they are about to be asked for.
 */
function stepsFor(aboveDailyLimit: boolean): StepCopy[] {
  return aboveDailyLimit
    ? [
        {
          key: "reason",
          title: "Above your daily limit",
          body: "Your Account approves larger amounts as well as you.",
        },
        ...CHECK_STEPS,
      ]
    : CHECK_STEPS;
}

const CHECK_STEPS: StepCopy[] = [
  {
    key: "identity",
    title: "Check it is you",
    body: "Your phone asks for your face or your fingerprint.",
  },
  {
    key: "sending",
    title: "Sending",
    body: "Handing the payment to the network.",
  },
];
