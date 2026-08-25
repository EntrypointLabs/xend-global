import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, TextInput, View } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { Ionicons } from "@expo/vector-icons";

import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { QRScannerModal } from "@/components/ui/organisms/send/QRScannerModal";
import { isSignerAddress } from "@/utils/solana";

/**
 * Takes the wallet address, and refuses a malformed one here.
 *
 * The program only rejects a bad signer when the settings change executes,
 * which is after two approvals and the whole time lock, having consumed an
 * index. Catching it at the keyboard is the difference between a typo and a
 * wasted day.
 */
export default function AddRecoveryWalletScreen() {
  const scannerRef = useRef<BottomSheetModal>(null);
  const [address, setAddress] = useState("");

  const trimmed = address.trim();
  const valid = isSignerAddress(trimmed);
  const malformed = trimmed.length > 0 && !valid;

  const paste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setAddress(text.trim());
  };

  return (
    <ScreenLayout>
      <KeyboardAvoidingView
        className="flex-1 px-3"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <HapticPressable
          onPress={() => router.back()}
          className="size-10 items-center justify-center rounded-full bg-black/[0.08]"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={20} color="#00000066" />
        </HapticPressable>

        <Typography
          weight="700"
          className="mt-10 text-5xl leading-[44px] text-black"
        >
          Crypto Wallet
        </Typography>

        <Typography
          weight="600"
          className="mt-5 text-[15px] leading-6 text-black"
        >
          Enter a wallet address{"\n"}in the field below
        </Typography>

        <View className="mt-7 flex-row items-center gap-6 rounded-3xl bg-black/[0.03] px-5 py-4">
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="Enter public key"
            placeholderTextColor="#00000040"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            className="flex-1 text-[15px] text-black"
          />
          <HapticPressable onPress={paste} accessibilityLabel="Paste address">
            <Typography weight="600" className="text-[15px] text-black">
              Paste
            </Typography>
          </HapticPressable>
          <HapticPressable
            onPress={() => scannerRef.current?.present()}
            accessibilityLabel="Scan a QR code"
          >
            <Ionicons name="scan-outline" size={18} color="#000000" />
          </HapticPressable>
        </View>

        {malformed ? (
          <View className="mt-4 flex-row gap-2">
            <Ionicons
              name="information-circle-outline"
              size={18}
              color="#F90101"
            />
            <Typography
              weight="500"
              className="flex-1 text-sm text-destructive"
            >
              That is not an address that can sign. Check it, and make sure it
              is a self-custody wallet.
            </Typography>
          </View>
        ) : (
          <View className="mt-4 flex-row gap-2">
            <Ionicons
              name="information-circle-outline"
              size={18}
              color="#00000040"
            />
            <Typography
              weight="400"
              className="flex-1 text-sm leading-5 text-black/40"
            >
              Do not use an address from a centralised exchange. This must be a
              self-custody wallet you can sign with.
            </Typography>
          </View>
        )}

        <View className="flex-1" />

        <HapticPressable
          onPress={() =>
            valid &&
            router.push({
              pathname: "/settings/confirm-recovery-key",
              params: { address: trimmed },
            } as never)
          }
          disabled={!valid}
          className={`h-14 items-center justify-center rounded-full ${
            valid ? "bg-black" : "bg-black/50"
          }`}
        >
          <Typography weight="700" className="text-[15px] text-white">
            Next
          </Typography>
        </HapticPressable>
      </KeyboardAvoidingView>

      <QRScannerModal
        ref={scannerRef}
        onScan={(scanned) => setAddress(scanned.trim())}
      />
    </ScreenLayout>
  );
}
