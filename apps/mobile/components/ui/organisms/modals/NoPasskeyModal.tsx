import React from "react";
import { ActivityIndicator, Modal, StyleSheet, View } from "react-native";

import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { FrostBlurView } from "@/components/ui/atoms/FrostBlurView";
import { useThemeColor } from "@/hooks/useThemeColor";
import { cn } from "@/utils/cn";

interface NoPasskeyModalProps {
  visible: boolean;
  onRecover: () => void;
  onCreate: () => void;
  onDismiss: () => void;
  isCreating: boolean;
  error: string | null;
}

/**
 * Stands between "this device has no passkey" and "so make a new account".
 *
 * Those are not the same thing. A passkey lives in one ecosystem, so someone
 * who signed up on an iPhone and picked up an Android phone arrives here with
 * an account, a wallet and a balance that this device cannot see. Creating
 * silently would give them a second empty wallet and no route back to the
 * first, and the wrong choice is only obvious once the money is missing.
 *
 * So the recovery route leads, and creating is the deliberate second option.
 */
export function NoPasskeyModal({
  visible,
  onRecover,
  onCreate,
  onDismiss,
  isCreating,
  error,
}: NoPasskeyModalProps) {
  const backgroundColor = useThemeColor({}, "background");

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <FrostBlurView style={[StyleSheet.absoluteFill, styles.overlay]}>
        <View style={[styles.modalContainer, { backgroundColor }]}>
          <Typography weight="600" className="mb-2 text-center text-xl">
            No passkey on this device
          </Typography>

          <Typography
            weight="400"
            className="mb-6 text-center text-sm leading-5 opacity-60"
          >
            If you already have a Xend account, it was set up on another device.
            Passkeys do not move between Apple and Android, so recover your
            wallet here instead of starting again.
          </Typography>

          {error && (
            <Typography
              weight="400"
              className="mb-4 text-center text-sm text-[#FF4444]"
            >
              {error}
            </Typography>
          )}

          <HapticPressable
            onPress={onRecover}
            disabled={isCreating}
            className={cn(
              "w-full items-center justify-center rounded-full bg-black py-4",
              isCreating && "opacity-50"
            )}
          >
            <Typography weight="600" className="text-base text-white">
              Recover my wallet
            </Typography>
          </HapticPressable>

          <HapticPressable
            onPress={onCreate}
            disabled={isCreating}
            className={cn(
              "mt-3 w-full items-center justify-center rounded-full border py-4",
              isCreating && "opacity-50"
            )}
          >
            {isCreating ? (
              <ActivityIndicator />
            ) : (
              <Typography weight="600" className="text-base">
                Create a new account
              </Typography>
            )}
          </HapticPressable>

          <HapticPressable
            onPress={onDismiss}
            disabled={isCreating}
            className="mt-3 items-center justify-center py-3"
          >
            <Typography weight="500" className="text-sm opacity-60">
              Cancel
            </Typography>
          </HapticPressable>
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
