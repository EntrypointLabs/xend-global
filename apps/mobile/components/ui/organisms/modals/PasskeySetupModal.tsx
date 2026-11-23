import React from "react";
import { View, ActivityIndicator, Modal, StyleSheet } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { FrostBlurView } from "@/components/ui/atoms/FrostBlurView";
import { usePalette } from "@/hooks/usePalette";
import { cn } from "@/utils/cn";

interface PasskeySetupModalProps {
  visible: boolean;
  onAddPasskey: () => void;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onSkip?: () => void;
  skipLabel?: string;
}

export function PasskeySetupModal({
  visible,
  onAddPasskey,
  isLoading,
  error,
  onRetry,
  onSkip,
  skipLabel = "Skip for now",
}: PasskeySetupModalProps) {
  const palette = usePalette();
  const backgroundColor = palette.card;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <FrostBlurView
        tint={palette.dark ? "dark" : "light"}
        style={[StyleSheet.absoluteFill, styles.overlay]}
      >
        <View style={[styles.modalContainer, { backgroundColor }]}>
          <View className="items-center">
            <View className="mb-4">
              <Typography weight="700" className="text-[40px]">
                {"🔒"}
              </Typography>
            </View>

            <Typography
              weight="600"
              className="mb-2 text-center text-xl text-foreground"
            >
              Set up your passkey
            </Typography>

            <Typography
              weight="400"
              className="mb-6 max-w-[260px] text-center text-sm leading-5 text-foreground opacity-50"
            >
              A passkey lets you securely sign transactions using biometrics
              like Face ID or fingerprint.
            </Typography>

            {error ? (
              <View className="w-full items-center">
                <Typography
                  weight="400"
                  className="mb-4 text-center text-sm text-[#FF4444] dark:text-destructive"
                >
                  {error}
                </Typography>
                <HapticPressable
                  onPress={onRetry}
                  disabled={isLoading}
                  className={cn(
                    "w-full items-center justify-center rounded-full bg-primary py-4",
                    isLoading && "opacity-50"
                  )}
                >
                  {isLoading ? (
                    <ActivityIndicator color={palette.primaryForeground} />
                  ) : (
                    <Typography
                      weight="600"
                      className="text-base text-primary-foreground"
                    >
                      Try Again
                    </Typography>
                  )}
                </HapticPressable>
              </View>
            ) : (
              <HapticPressable
                onPress={onAddPasskey}
                disabled={isLoading}
                className={cn(
                  "w-full items-center justify-center rounded-full bg-primary py-4",
                  isLoading && "opacity-50"
                )}
              >
                {isLoading ? (
                  <ActivityIndicator color={palette.primaryForeground} />
                ) : (
                  <Typography
                    weight="600"
                    className="text-base text-primary-foreground"
                  >
                    Set up Passkey
                  </Typography>
                )}
              </HapticPressable>
            )}

            {onSkip && (
              <HapticPressable
                onPress={onSkip}
                disabled={isLoading}
                className="mt-3 items-center justify-center py-3"
              >
                <Typography
                  weight="500"
                  className="text-sm text-foreground opacity-60"
                >
                  {skipLabel}
                </Typography>
              </HapticPressable>
            )}
          </View>
        </View>
      </FrostBlurView>
    </Modal>
  );
}

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
