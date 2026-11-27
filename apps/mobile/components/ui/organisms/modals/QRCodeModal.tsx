import React, { useMemo, useCallback, forwardRef, memo } from "react";
import { View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { BlurBackdrop } from "@/components/ui/molecules/BlurBackdrop";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";
import { Ionicons } from "@expo/vector-icons";
import { useToast } from "@/contexts/ToastContext";
import { usePalette } from "@/hooks/usePalette";
import { analytics } from "@/utils/analytics";

interface QRCodeModalProps {
  walletAddress: string;
}

export const QRCodeModal = forwardRef<BottomSheetModal, QRCodeModalProps>(
  ({ walletAddress }, ref) => {
    const snapPoints = useMemo(() => ["94%"], []);
    const { showToast } = useToast();
    const palette = usePalette();

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => <BlurBackdrop {...props} />,
      []
    );

    const handleCopyAddress = async () => {
      await Clipboard.setStringAsync(walletAddress);
      analytics.track("receive_details_copied", { kind: "address" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(
        "Copied address",
        <Ionicons
          name="checkmark-circle"
          size={16}
          color={palette.foreground}
        />
      );
    };

    return (
      <BottomSheetModal
        ref={ref}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        handleIndicatorStyle={{ display: "none" }}
        backgroundStyle={{
          backgroundColor: palette.dark ? palette.background : "#F0F0F0",
        }}
        containerStyle={{ zIndex: 1 }}
      >
        <BottomSheetView className="h-full flex-1 bg-[#F0F0F0] dark:bg-background">
          <View className="mb-5 items-center px-4">
            <TabHeaderText className="text-center">Receive</TabHeaderText>
            <Typography
              weight="500"
              className="mt-1 text-sm text-foreground/30"
            >
              Only send Solana assets to this address
            </Typography>
          </View>

          <View className="z-[0] mx-auto mt-12 h-10 w-[70%] rounded-full bg-foreground/5" />
          <HapticPressable
            onPress={handleCopyAddress}
            className="mx-10 -mt-8 items-center rounded-[28px] border border-black/5 bg-white p-8"
          >
            <View className="relative w-full bg-transparent">
              <MemoizedQRCodeModal walletAddress={walletAddress} />
            </View>
            <Typography
              weight="500"
              className="mx-auto mt-5 max-w-[198px] text-center text-sm leading-4 text-black/30"
            >
              {walletAddress}
            </Typography>
          </HapticPressable>

          <View className="h-full flex-1" />

          <View className="mx-6 mb-8">
            <HapticPressable
              className="items-center rounded-full bg-primary py-4"
              onPress={handleCopyAddress}
            >
              <Typography
                weight="700"
                className="text-base text-primary-foreground"
              >
                Copy address
              </Typography>
            </HapticPressable>
          </View>
        </BottomSheetView>
      </BottomSheetModal>
    );
  }
);

QRCodeModal.displayName = "QRCodeModal";

const MemoizedQRCodeModal = memo(
  ({
    walletAddress,
    color = "black",
    backgroundColor = "transparent",
  }: {
    walletAddress: string;
    color?: string;
    backgroundColor?: string;
  }) => {
    return (
      <QRCode
        value={walletAddress}
        size={280}
        color={color}
        backgroundColor={backgroundColor}
        ecl="L"
      />
    );
  }
);

MemoizedQRCodeModal.displayName = "MemoizedQRCodeModal";
