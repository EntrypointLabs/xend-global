import { GlassButton } from "@/components/ui/atoms/Glass";
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
import { usePalette } from "@/hooks/usePalette";
import { withSystemPrompt } from "@/utils/systemPrompt";

/**
 * Takes the wallet address, and refuses a malformed one here.
 *
 * The program only rejects a bad signer when the settings change executes,
 * which is after two approvals and the whole time lock, having consumed an
 * index. Catching it at the keyboard is the difference between a typo and a
 * wasted day.
 */
export default function AddRecoveryWalletScreen() {
  const palette = usePalette();
  const scannerRef = useRef<BottomSheetModal>(null);
  const [address, setAddress] = useState("");

  const trimmed = address.trim();
  const valid = isSignerAddress(trimmed);
  const malformed = trimmed.length > 0 && !valid;

  const paste = async () => {
    const text = await withSystemPrompt(() => Clipboard.getStringAsync());
    if (text) setAddress(text.trim());
  };

  return (
    <ScreenLayout>
      <KeyboardAvoidingView
        className="flex-1 px-3"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <GlassButton
          radius={999}
          onPress={() => router.back()}
          className="size-10 items-center justify-center rounded-full"
          fallbackClassName="border border-foreground/[0.08] bg-card"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={20} color={palette.foreground} />
        </GlassButton>

        <Typography
          weight="700"
          className="mt-10 text-5xl leading-[44px] text-foreground"
        >
          Crypto Wallet
        </Typography>

        <Typography
          weight="600"
          className="mt-5 text-[15px] leading-6 text-foreground"
        >
          Enter a wallet address{"\n"}in the field below
        </Typography>

        <View className="mt-7 flex-row items-center gap-6 rounded-3xl bg-foreground/[0.03] px-5 py-4">
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="Enter public key"
            placeholderTextColor={palette.fg(0.25)}
            keyboardAppearance={palette.dark ? "dark" : "light"}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            className="flex-1 text-[15px] text-foreground"
          />
          <HapticPressable onPress={paste} accessibilityLabel="Paste address">
            <Typography weight="600" className="text-[15px] text-foreground">
              Paste
            </Typography>
          </HapticPressable>
          <HapticPressable
            onPress={() => scannerRef.current?.present()}
            accessibilityLabel="Scan a QR code"
          >
            <Ionicons
              name="scan-outline"
              size={18}
              color={palette.foreground}
            />
          </HapticPressable>
        </View>

        {malformed ? (
          <View className="mt-4 flex-row gap-2">
            <Ionicons
              name="information-circle-outline"
              size={18}
              color={palette.destructive}
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
              color={palette.fg(0.25)}
            />
            <Typography
              weight="400"
              className="flex-1 text-sm leading-5 text-foreground/40"
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
            valid ? "bg-primary" : "bg-primary/50"
          }`}
        >
          <Typography
            weight="700"
            className="text-[15px] text-primary-foreground"
          >
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
