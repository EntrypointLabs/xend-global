import React, { useEffect, useRef, useState } from "react";
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { cn } from "@/utils/cn";

interface EditWalletModalProps {
  visible: boolean;
  onClose: () => void;
  initialName: string;
  address: string;
  onSave: (name: string) => void;
}

const truncate = (address: string) => {
  if (!address) return "";
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
};

export function EditWalletModal({
  visible,
  onClose,
  initialName,
  address,
  onSave,
}: EditWalletModalProps) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setName(initialName);
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [visible, initialName]);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed !== initialName;

  const handleSave = () => {
    if (!canSave) return;
    onSave(trimmed);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <BlurView
        intensity={20}
        tint="dark"
        style={StyleSheet.absoluteFill}
        experimentalBlurMethod="dimezisBlurView"
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            Keyboard.dismiss();
            onClose();
          }}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.center}
          pointerEvents="box-none"
        >
          <Pressable onPress={() => {}} style={styles.cardWrapper}>
            <View className="w-[88%] self-center rounded-3xl bg-white p-6">
              <View className="mb-4 flex-row items-start justify-between">
                <View className="h-12 w-12 items-center justify-center rounded-2xl bg-black">
                  <Image
                    source={require("@/assets/icons/edit-wallet.png")}
                    className="size-6"
                    resizeMode="contain"
                  />
                </View>
                <HapticPressable onPress={onClose} className="p-1">
                  <Ionicons name="close" size={22} color="#00000066" />
                </HapticPressable>
              </View>

              <View className="items-center">
                <TextInput
                  ref={inputRef}
                  value={name}
                  onChangeText={setName}
                  placeholder="Wallet name"
                  placeholderTextColor="#00000040"
                  className="text-center text-2xl font-bold text-black"
                  blurOnSubmit={false}
                  returnKeyType="done"
                  onSubmitEditing={handleSave}
                />
                <Typography weight="500" className="mt-1 text-sm text-black/40">
                  {truncate(address)}
                </Typography>
              </View>

              <HapticPressable
                onPress={handleSave}
                disabled={!canSave}
                className={cn(
                  "mt-6 items-center justify-center rounded-full py-4",
                  canSave ? "bg-black" : "bg-black/30"
                )}
              >
                <Typography weight="600" className="text-base text-white">
                  Save
                </Typography>
              </HapticPressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </BlurView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
  },
  cardWrapper: {
    width: "100%",
  },
});
