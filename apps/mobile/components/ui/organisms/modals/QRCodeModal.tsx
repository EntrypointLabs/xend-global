import React, { useMemo, useCallback, forwardRef, useState, memo } from "react";
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
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useToast } from "@/contexts/ToastContext";
import { cn } from "@/utils/cn";
import { Toggle } from "@/components/ui/atoms/Toggle";

interface QRCodeModalProps {
  walletAddress: string;
}

export const QRCodeModal = forwardRef<BottomSheetModal, QRCodeModalProps>(
  ({ walletAddress }, ref) => {
    const snapPoints = useMemo(() => ["94%"], []);
    const { showToast } = useToast();
    const [isHideWalletEnabled, setIsHideWalletEnabled] = useState(false);

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => <BlurBackdrop {...props} />,
      []
    );

    const handleCopyAddress = async () => {
      await Clipboard.setStringAsync(walletAddress);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(
        "Copied address",
        <Ionicons name="checkmark-circle" size={16} color="black" />
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
        backgroundStyle={{ backgroundColor: "#F0F0F0" }}
        containerStyle={{ zIndex: 1 }}
      >
        <BottomSheetView className="h-full flex-1 bg-[#F0F0F0]">
          <View className="mb-5 items-center px-4">
            <TabHeaderText className="text-center">Receive</TabHeaderText>
            <Typography weight="500" className="mt-1 text-sm text-black/30">
              Only send Solana assets to this address
            </Typography>
          </View>

          <View className="z-[0] mx-auto mt-12 h-10 w-[70%] rounded-full bg-black/5" />
          <HapticPressable
            onPress={handleCopyAddress}
            className={cn(
              "mx-10 -mt-8 items-center rounded-[28px] border border-black/5 bg-white p-8",
              {
                "bg-[#3B82F6]": isHideWalletEnabled,
              }
            )}
          >
            <View className="relative w-full bg-transparent">
              <MemoizedQRCodeModal
                walletAddress={walletAddress}
                color={isHideWalletEnabled ? "white" : "black"}
              />
            </View>
            <Typography
              weight="500"
              className={cn(
                "mx-auto mt-5 max-w-[198px] text-center text-sm leading-4 text-black/30",
                {
                  "text-white/40": isHideWalletEnabled,
                }
              )}
            >
              {walletAddress}
            </Typography>
          </HapticPressable>

          <View className="h-full flex-1" />

          <View className="mx-6 mb-7 flex-row items-center justify-between">
            <View className="flex-row items-center px-2">
              <MaterialCommunityIcons
                name="shield-half-full"
                size={28}
                color="#3B82F6"
              />
              <View className="ml-3">
                <Typography weight="600" className="text-base">
                  Receive with <Typography>Hide My Wallet</Typography>
                </Typography>
                <View className="flex-row items-center">
                  <Typography
                    weight="600"
                    className="mr-1 text-sm text-black/30"
                  >
                    How it works?
                  </Typography>
                  <Ionicons
                    name="information-circle-outline"
                    size={16}
                    color="#0000004D"
                  />
                </View>
              </View>
            </View>
            <Toggle
              value={isHideWalletEnabled}
              onValueChange={setIsHideWalletEnabled}
            />
          </View>

          <View className="mx-6 mb-8">
            <HapticPressable
              className={cn("items-center rounded-full border-none py-4", {
                "bg-black/5": !isHideWalletEnabled,
                "bg-[#3B82F6]": isHideWalletEnabled,
              })}
              onPress={handleCopyAddress}
            >
              <Typography
                weight="700"
                className={cn("text-base text-black", {
                  "text-white": isHideWalletEnabled,
                })}
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
