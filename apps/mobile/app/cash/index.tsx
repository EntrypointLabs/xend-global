import React, { useMemo, useState, useRef } from "react";
import { View, ScrollView, TouchableOpacity, Image } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import { useRouter } from "expo-router";
import { ScreenLayout } from "@/components/ui/layout";
import { Ionicons } from "@expo/vector-icons";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";
import { ActionPill } from "@/components/ui/molecules";
import { SendModal } from "@/components/ui/organisms/modals/SendModal";
import { ReceiveModal } from "@/components/ui/organisms/modals/ReceiveModal";
import { QRCodeModal } from "@/components/ui/organisms/modals/QRCodeModal";
import { SendFlowModal } from "@/components/ui/organisms/send/SendFlowModal";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useModalFlow } from "@/contexts/ModalFlowContext";
import { useToast } from "@/contexts/ToastContext";
import BalanceView from "@/components/BalanceView";
import { useBalances } from "@/hooks/useBalances";
import { useWalletAddress } from "@/hooks/useWalletAddress";

export default function CashScreen() {
  const router = useRouter();
  const { hideAllModals } = useModalFlow();
  const { showToast } = useToast();
  const {
    totalDisplay,
    usdc,
    isError: isBalanceError,
    refetch: refetchBalances,
  } = useBalances();
  const address = useWalletAddress();

  // Modal State
  const [isSendModalVisible, setIsSendModalVisible] = useState(false);
  const [isReceiveModalVisible, setIsReceiveModalVisible] = useState(false);
  const sendFlowModalRef = useRef<BottomSheetModal>(null);
  const qrCodeModalRef = useRef<BottomSheetModal>(null);

  // useBalances defaults `usdc` to 0, so the empty-wallet case renders as
  // "0 USDC" / "0.00" without an explicit null guard. On a failed fetch the
  // total is likewise 0, so show a neutral placeholder rather than a bogus zero.
  const usdcLabel = isBalanceError
    ? "USDC"
    : `${usdc.toLocaleString("en-US", {
        maximumFractionDigits: 4,
      })} USDC`;
  const usdcAmount = usdc.toFixed(2);

  // The address is null for a beat on cold start; don't open a blank QR.
  const handleOpenQRCode = () => {
    if (!address) {
      showToast("Preparing your address…");
      return;
    }
    qrCodeModalRef.current?.present();
  };

  const actionItems = useMemo(
    () => [
      {
        icon: () => (
          <View className="flex-row items-center gap-2">
            <View className="h-6 w-6 items-center justify-center rounded-full bg-black">
              <Ionicons name="arrow-down" size={14} color="white" />
            </View>
            <Typography weight="700" className="text-lg">
              Receive
            </Typography>
          </View>
        ),
        onPress: () => setIsReceiveModalVisible(true),
        label: "Receive",
      },
      {
        icon: () => (
          <View className="flex-row items-center gap-2">
            <Ionicons name="paper-plane-outline" size={20} color="black" />
            <Typography weight="700" className="text-lg">
              Send
            </Typography>
          </View>
        ),
        onPress: () => setIsSendModalVisible(true),
        label: "Send",
      },
    ],
    []
  );

  return (
    <ScreenLayout>
      <View className="relative w-full flex-1">
        {/* Header */}
        <View className="mb-6 flex-row items-center">
          <Image
            source={require("@/assets/icons/usdc.png")}
            className="mr-2.5 size-9"
            resizeMode="contain"
          />
          <TabHeaderText className="pb-0">Cash</TabHeaderText>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerClassName="pb-[100px]"
        >
          {/* Balance */}
          <View className="mb-8">
            <Typography weight="500" className="mb-1 text-base text-black/30">
              Balance
            </Typography>

            {isBalanceError ? (
              <HapticPressable
                className="flex-row items-center gap-1.5 self-start"
                onPress={() => refetchBalances()}
              >
                <Typography weight="700" variant="h2">
                  ——
                </Typography>
                <View className="flex-row items-center gap-1 rounded-full bg-black/5 px-2.5 py-1">
                  <Ionicons name="refresh" size={14} color="#999" />
                  <Typography weight="500" className="text-sm text-black/40">
                    Couldn't load. Tap to retry
                  </Typography>
                </View>
              </HapticPressable>
            ) : (
              <BalanceView weight="700" variant="h2" amount={totalDisplay} />
            )}
          </View>

          {/* USDC Card */}
          <View className="mb-8 rounded-[24px] border border-[#A3A3A3]/20 bg-white p-5">
            <View className="mb-4 flex-row items-start justify-between">
              <Image
                source={require("@/assets/icons/usdc.png")}
                className="h-10 w-10"
                resizeMode="contain"
              />
            </View>

            <View className="mb-4 flex-row items-end justify-between">
              <View>
                <Typography weight="700" className="mb-1 text-lg">
                  USDC
                </Typography>
                <Typography weight="600" className="text-black/30">
                  {usdcLabel}
                </Typography>
              </View>
              {isBalanceError ? (
                <Typography weight="600" className="text-lg text-black/30">
                  —
                </Typography>
              ) : (
                <BalanceView
                  weight="600"
                  className="text-lg"
                  amount={usdcAmount}
                />
              )}
            </View>

            <View className="my-2 h-px w-full border-t border-dashed border-gray-200 bg-gray-100" />

            <TouchableOpacity className="flex-row items-center justify-between pt-2">
              <View className="flex-row items-center">
                <View className="mr-2 h-5 w-5 items-center justify-center rounded-full bg-blue-500">
                  <Ionicons name="trending-up" size={12} color="white" />
                </View>
                <Typography weight="500">
                  Earn{" "}
                  <Typography weight="500" className="text-blue-500">
                    7.57%{" "}
                  </Typography>
                  <Typography weight="500">APY</Typography>
                </Typography>
              </View>
              <View className="flex-row items-center">
                <Typography weight="500" className="mr-1 text-sm text-black/30">
                  Put USDC into Earn
                </Typography>
                <Ionicons name="chevron-forward" size={12} color="#999" />
              </View>
            </TouchableOpacity>
          </View>

          <View>
            <Typography weight="500" className="mb-4">
              Other assets
            </Typography>
            <View className="flex-row items-center">
              <View className="mr-2 size-10 rounded-full border-2 border-dashed border-black/40" />
              <View>
                <Typography weight="500" className="text-sm text-black/30">
                  You have no other
                </Typography>
                <Typography weight="500" className="text-sm text-black/30">
                  cash assets yet
                </Typography>
              </View>
            </View>
          </View>
        </ScrollView>

        {/* Bottom Actions */}
        <View className="absolute bottom-0 left-0 right-0 flex-row items-center justify-between bg-transparent">
          {/* Back Button */}
          <HapticPressable
            className="h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm"
            onPress={() => router.back()}
          >
            <Ionicons name="chevron-back" size={24} color="black" />
          </HapticPressable>

          {/* Action Pill */}
          <ActionPill items={actionItems} />
        </View>
      </View>

      {/* Modals */}
      <SendModal
        visible={isSendModalVisible}
        onClose={() => setIsSendModalVisible(false)}
        onSendToWallet={() => {
          setIsSendModalVisible(false);
          sendFlowModalRef.current?.present();
        }}
      />

      <SendFlowModal ref={sendFlowModalRef} onClose={() => {}} />

      <ReceiveModal
        visible={isReceiveModalVisible}
        onClose={() => {
          setIsReceiveModalVisible(false);
          hideAllModals(); // Ensure flow context is cleared if needed
        }}
        onOpenQRCode={handleOpenQRCode}
      />

      <QRCodeModal ref={qrCodeModalRef} walletAddress={address ?? ""} />
    </ScreenLayout>
  );
}
