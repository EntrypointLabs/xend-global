import React from "react";
import { View, ActivityIndicator, Modal, StyleSheet } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { FrostBlurView } from "@/components/ui/atoms/FrostBlurView";
import { useThemeColor } from "@/hooks/useThemeColor";
import { cn } from "@/utils/cn";
import type { AccountSetupStage } from "@/hooks/useAccountSetup";

interface AccountSetupModalProps {
  visible: boolean;
  stage: AccountSetupStage;
  error: string | null;
  onStart: () => void;
  onRetry: () => void;
  onSkip: () => void;
}

/**
 * Explains the wallet setup that follows sign-up, and the fingerprint prompts
 * it costs.
 *
 * This exists because the work cannot be done for the Consumer. Securing the
 * wallet means changing its on-chain settings, and those changes need two of
 * its three signers; the server holds one and the phone holds two, so the
 * phone has to sign. Left unannounced, that surfaced as a fingerprint prompt
 * appearing over the dashboard of an account with no money in it.
 */
export function AccountSetupModal({
  visible,
  stage,
  error,
  onStart,
  onRetry,
  onSkip,
}: AccountSetupModalProps) {
  const backgroundColor = useThemeColor({}, "background");
  const copy = STAGE_COPY[stage];
  const busy = stage !== "idle";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <FrostBlurView style={[StyleSheet.absoluteFill, styles.overlay]}>
        <View style={[styles.modalContainer, { backgroundColor }]}>
          <View className="items-center">
            <View className="mb-4">
              <Typography weight="700" className="text-[40px]">
                {"🛡️"}
              </Typography>
            </View>

            <Typography weight="600" className="mb-2 text-center text-xl">
              {copy.title}
            </Typography>

            <Typography
              weight="400"
              className="mb-6 max-w-[260px] text-center text-sm leading-5 opacity-50"
            >
              {copy.body}
            </Typography>

            {error ? (
              <View className="w-full items-center">
                <Typography
                  weight="400"
                  className="mb-4 text-center text-sm text-[#FF4444]"
                >
                  {error}
                </Typography>
                <HapticPressable
                  onPress={onRetry}
                  className="w-full items-center justify-center rounded-full bg-black py-4"
                >
                  <Typography weight="600" className="text-base text-white">
                    Try Again
                  </Typography>
                </HapticPressable>
              </View>
            ) : (
              <HapticPressable
                onPress={onStart}
                disabled={busy}
                className={cn(
                  "w-full items-center justify-center rounded-full bg-black py-4",
                  busy && "opacity-50"
                )}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Typography weight="600" className="text-base text-white">
                    Secure my wallet
                  </Typography>
                )}
              </HapticPressable>
            )}

            {/* Only offered when nothing is mid-flight. Leaving during a
                signature would strand a half-applied settings change. */}
            {!busy && (
              <HapticPressable
                onPress={onSkip}
                className="mt-3 items-center justify-center py-3"
              >
                <Typography
                  weight="500"
                  className="text-sm text-black opacity-60"
                >
                  {error ? "Continue anyway" : "Not now"}
                </Typography>
              </HapticPressable>
            )}
          </View>
        </View>
      </FrostBlurView>
    </Modal>
  );
}

/**
 * Consumer-facing names for the stages.
 *
 * Deliberately not the internal ones. "Above-limit policy" and "settings time
 * lock" describe the mechanism; these describe what the Consumer gets.
 */
const STAGE_COPY: Record<AccountSetupStage, { title: string; body: string }> = {
  idle: {
    title: "Secure your Account",
    body: "One quick step sets up your spending limit and approvals. You will be asked for your fingerprint once.",
  },
  creating: {
    title: "Creating your Account",
    body: "Setting up the account that holds your money.",
  },
  securing: {
    title: "Securing your Account",
    body: "Setting your daily limit and approvals, so everyday payments go through with a single tap.",
  },
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  modalContainer: {
    width: "93%",
    borderRadius: 32,
    paddingHorizontal: 24,
    paddingVertical: 28,
    margin: 21,
    overflow: "hidden",
  },
});
