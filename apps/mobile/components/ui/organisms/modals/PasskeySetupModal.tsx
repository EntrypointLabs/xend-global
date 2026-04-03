import React from "react";
import { View, ActivityIndicator, Modal, StyleSheet } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { BlurView } from "expo-blur";
import { useThemeColor } from "@/hooks/useThemeColor";

interface PasskeySetupModalProps {
  visible: boolean;
  onAddPasskey: () => void;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function PasskeySetupModal({
  visible,
  onAddPasskey,
  isLoading,
  error,
  onRetry,
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
        style={[styles.overlay, { backgroundColor: "rgb(189, 189, 189, 1)" }]}
        tint="dark"
        experimentalBlurMethod="dimezisBlurView"
      >
        <View style={[styles.modalContainer, { backgroundColor }]}>
          <View style={styles.content}>
            <View style={styles.iconContainer}>
              <Typography weight="700" style={styles.icon}>
                {"\uD83D\uDD12"}
              </Typography>
            </View>

            <Typography weight="600" style={styles.title}>
              Set up your passkey
            </Typography>

            <Typography weight="400" style={styles.description}>
              A passkey lets you securely sign transactions using biometrics like
              Face ID or fingerprint.
            </Typography>

            {error ? (
              <View style={styles.errorContainer}>
                <Typography weight="400" style={styles.errorText}>
                  {error}
                </Typography>
                <HapticPressable
                  onPress={onRetry}
                  disabled={isLoading}
                  style={[styles.button, { opacity: isLoading ? 0.5 : 1 }]}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Typography weight="600" style={styles.buttonText}>
                      Try Again
                    </Typography>
                  )}
                </HapticPressable>
              </View>
            ) : (
              <HapticPressable
                onPress={onAddPasskey}
                disabled={isLoading}
                style={[styles.button, { opacity: isLoading ? 0.5 : 1 }]}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Typography weight="600" style={styles.buttonText}>
                    Set up Passkey
                  </Typography>
                )}
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
  content: {
    alignItems: "center",
  },
  iconContainer: {
    marginBottom: 16,
  },
  icon: {
    fontSize: 40,
  },
  title: {
    fontSize: 20,
    marginBottom: 8,
    textAlign: "center",
  },
  description: {
    fontSize: 14,
    opacity: 0.5,
    textAlign: "center",
    maxWidth: 260,
    marginBottom: 24,
    lineHeight: 20,
  },
  errorContainer: {
    width: "100%",
    alignItems: "center",
  },
  errorText: {
    fontSize: 14,
    color: "#FF4444",
    textAlign: "center",
    marginBottom: 16,
  },
  button: {
    width: "100%",
    backgroundColor: "#000",
    borderRadius: 100,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
  },
});
