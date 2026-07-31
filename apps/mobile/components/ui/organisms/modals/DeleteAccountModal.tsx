import React, { useState } from "react";
import { Image, Modal, Pressable, StyleSheet, View } from "react-native";
import { FrostBlurView } from "@/components/ui/atoms/FrostBlurView";
import { Ionicons } from "@expo/vector-icons";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { cn } from "@/utils/cn";
import { apiClient } from "@/utils/apiClient";
import { useToast } from "@/contexts/ToastContext";
import { ErrorCode, ErrorMessages } from "@/utils/errors";

interface DeleteAccountModalProps {
  visible: boolean;
  onClose: () => void;
  balance: number;
  balanceDisplay: string;
  onDeleted: () => void | Promise<void>;
}

export function DeleteAccountModal({
  visible,
  onClose,
  balance,
  balanceDisplay,
  onDeleted,
}: DeleteAccountModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const { showToast } = useToast();
  const canDelete = balance === 0;

  const handleDelete = async () => {
    if (!canDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await apiClient.deleteAccount();
      onClose();
      await onDeleted();
    } catch (err) {
      const code = (err as { data?: { code?: string } })?.data?.code;
      showToast(
        code === "ACCOUNT_HAS_BALANCE"
          ? ErrorMessages[ErrorCode.ACCOUNT_HAS_BALANCE]
          : ErrorMessages[ErrorCode.UNKNOWN_ERROR]
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <FrostBlurView style={StyleSheet.absoluteFill}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          className="flex-1 items-center justify-center"
          pointerEvents="box-none"
        >
          <Pressable onPress={() => {}} className="w-full">
            <View className="w-[88%] self-center rounded-3xl bg-white p-6">
              <View className="mb-4 flex-row items-center justify-between">
                <Typography weight="700" className="text-xl text-black">
                  Delete Account
                </Typography>
                <HapticPressable onPress={onClose} className="p-1">
                  <Ionicons name="close" size={22} color="#00000066" />
                </HapticPressable>
              </View>

              <View className="h-44 items-center justify-center overflow-hidden rounded-3xl border border-black/10 bg-black/[0.03]">
                <View className="h-14 w-14 items-center justify-center rounded-full bg-[#F90101]">
                  <Ionicons name="trash" size={26} color="#fff" />
                </View>
                <Image
                  source={require("@/assets/images/logo/xend-mark-black-2048.png")}
                  className="absolute bottom-3 right-3 size-5 opacity-20"
                  resizeMode="contain"
                />
              </View>

              <Typography
                weight="500"
                className="mt-4 text-sm leading-5 text-black/60"
              >
                Deleting your account will permanently close it. If you
                continue, you will not be able to recover, access, or perform
                any other action with this account in Xend.
              </Typography>

              <Typography
                weight="500"
                className="mt-3 text-sm leading-5 text-black/60"
              >
                By continuing, you confirm your Balance is at $0 and that any
                assets sent to this account after deletion will be lost.
              </Typography>

              {!canDelete && (
                <Typography
                  weight="500"
                  className="mt-3 text-sm leading-5 text-destructive"
                >
                  You still have a Balance of {balanceDisplay} — send or
                  withdraw it first.
                </Typography>
              )}

              <View className="mt-6 flex-row gap-3">
                <HapticPressable
                  onPress={onClose}
                  className="flex-1 items-center justify-center rounded-full bg-black/5 py-4"
                >
                  <Typography weight="600" className="text-base text-black">
                    Cancel
                  </Typography>
                </HapticPressable>

                <HapticPressable
                  onPress={handleDelete}
                  disabled={!canDelete || isDeleting}
                  className={cn(
                    "flex-1 items-center justify-center rounded-full py-4",
                    canDelete ? "bg-black" : "bg-black/10"
                  )}
                >
                  <Typography
                    weight="600"
                    className={cn(
                      "text-base",
                      canDelete ? "text-white" : "text-black/40"
                    )}
                  >
                    {isDeleting ? "Deleting…" : "Continue"}
                  </Typography>
                </HapticPressable>
              </View>
            </View>
          </Pressable>
        </View>
      </FrostBlurView>
    </Modal>
  );
}
