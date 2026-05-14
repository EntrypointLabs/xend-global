import React from "react";
import { View, ActivityIndicator, Modal, StyleSheet } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { BlurView } from "expo-blur";
import { useThemeColor } from "@/hooks/useThemeColor";
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
  const backgroundColor = useThemeColor({}, "background");

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <BlurView
        intensity={44.2}
        style={[
          StyleSheet.absoluteFill,
          styles.overlay,
          { backgroundColor: "rgba(189, 189, 189, 1)" },
        ]}
        tint="dark"
        experimentalBlurMethod="dimezisBlurView"
      >
        <View style={[styles.modalContainer, { backgroundColor }]}>
          <View className="items-center">
            <View className="mb-4">
              <Typography weight="700" className="text-[40px]">
                {"🔒"}
              </Typography>
            </View>

            <Typography weight="600" className="mb-2 text-center text-xl">
              Set up your passkey
            </Typography>

            <Typography
              weight="400"
              className="mb-6 max-w-[260px] text-center text-sm leading-5 opacity-50"
            >
              A passkey lets you securely sign transactions using biometrics
              like Face ID or fingerprint.
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
                  disabled={isLoading}
                  className={cn(
                    "w-full items-center justify-center rounded-full bg-black py-4",
                    isLoading && "opacity-50"
                  )}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Typography weight="600" className="text-base text-white">
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
                  "w-full items-center justify-center rounded-full bg-black py-4",
                  isLoading && "opacity-50"
                )}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Typography weight="600" className="text-base text-white">
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
                  className="text-sm text-black opacity-60"
                >
                  {skipLabel}
                </Typography>
              </HapticPressable>
            )}
          </View>
        </View>
      </BlurView>
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
