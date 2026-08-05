import { View, ScrollView } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useRef } from "react";
import { ThemedText } from "@/components/ui/atoms";

import { ActionCard, PromoBanner } from "@/components/ui/molecules";
import { ScreenLayout } from "@/components/ui/layout";
import { SendModal } from "@/components/ui/organisms/modals/SendModal";
import { ReceiveModal } from "@/components/ui/organisms/modals/ReceiveModal";
import { QRCodeModal } from "@/components/ui/organisms/modals/QRCodeModal";
import { useModalFlow } from "@/contexts/ModalFlowContext";
import { useToast } from "@/contexts/ToastContext";
import { TransactionList } from "@/components/ui/organisms/TransactionList";
import { useBalances } from "@/hooks/useBalances";
import { useTransfersInfinite } from "@/hooks/useTransfers";
import { useWalletAddress } from "@/hooks/useWalletAddress";
import {
  groupIntoSections,
  mapTransferRowToActivityEntry,
} from "@/utils/activity";
import { useWalletName } from "@/hooks/useWalletName";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { useRouter } from "expo-router";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { SendFlowModal } from "@/components/ui/organisms/send/SendFlowModal";
import BalanceView from "@/components/BalanceView";

function HomeScreenContent() {
  const router = useRouter();
  const {
    showReceiveModal,
    isReceiveModalVisible,
    hideAllModals,
    isSendModalVisible,
  } = useModalFlow();
  const { showToast } = useToast();
  const {
    totalDisplay,
    decimalsByMint,
    isError: isBalanceError,
    refetch: refetchBalances,
  } = useBalances();
  const { data, isLoading } = useTransfersInfinite();
  const address = useWalletAddress();
  const { name: walletName } = useWalletName();
  const sendFlowModalRef = useRef<BottomSheetModal>(null);
  const qrCodeModalRef = useRef<BottomSheetModal>(null);

  const actions = useMemo(
    () => [
      {
        title: "Cash",
        subtitle: "Send and Receive",
        icon: require("@/assets/icons/usdc.png"),
        onPress: () => router.push("/cash"),
        color: "#007AFF", // Blue
      },
      {
        title: "Investments",
        subtitle: "Your other assets",
        icon: require("@/assets/icons/investment.png"),
        onPress: () => router.push("/investments"),
        color: "#FF9500", // Orange
      },
      {
        title: "Earn",
        subtitle: "Yield on your balance",
        icon: require("@/assets/icons/earn.png"),
        onPress: () => router.push("/earn"),
        color: "#AF52DE", // Purple
      },
    ],
    // Xend Card is intentionally absent until it exists. Advertising an action
    // that only raises "Coming soon" is a feature a dApp Store reviewer cannot
    // verify, which is what the first submission was rejected for.
    [router]
  );

  const rows = data?.pages.flatMap((page) => page.transfers) ?? [];
  const entries = rows.slice(0, 8).map((row) =>
    mapTransferRowToActivityEntry(row, {
      selfAddress: address ?? "",
      decimalsByMint,
    })
  );
  const sections = groupIntoSections(entries);

  return (
    <ScreenLayout>
      <ScrollView
        contentContainerClassName="grow pb-[100px]"
        showsVerticalScrollIndicator={false}
      >
        <View>
          <TabHeaderText>{walletName}</TabHeaderText>

          <View>
            <View className="flex-row items-center gap-2">
              <Typography weight="500" className="text-sm text-black/30">
                Total Balance{" "}
                <Ionicons name="remove-circle" size={12} color="#999" /> 100%
              </Typography>
            </View>
            {isBalanceError ? (
              <HapticPressable
                className="flex-row items-center gap-1.5 self-start py-2"
                onPress={() => refetchBalances()}
              >
                <Typography weight="700" className="text-[40px] leading-[140%]">
                  ——
                </Typography>
                <View className="flex-row items-center gap-1 rounded-full bg-black/5 px-2.5 py-1">
                  <Ionicons name="refresh" size={14} color="#999" />
                  <Typography weight="500" className="text-sm text-black/40">
                    Couldn&apos;t load balance. Tap to retry
                  </Typography>
                </View>
              </HapticPressable>
            ) : (
              <BalanceView
                weight="700"
                className="text-[40px] leading-[140%]"
                amount={totalDisplay}
              />
            )}
          </View>

          {entries.length === 0 && !isLoading && (
            <View className="items-center pb-6 pt-2">
              <Typography weight="600" className="mb-2 text-center text-xl">
                There is nothing here yet
              </Typography>
              <Typography
                weight="500"
                className="mb-7 max-w-[250px] text-center text-sm text-black/30"
              >
                Deposit tokens to your address and start using Xend Wallet
              </Typography>

              <HapticPressable
                className="flex-row items-center gap-0.5 rounded-full bg-black p-2.5 px-3"
                onPress={showReceiveModal}
              >
                <Ionicons name="arrow-down-circle" size={18} color="white" />
                <Typography weight="500" className="text-base text-white">
                  Receive
                </Typography>
              </HapticPressable>
            </View>
          )}
        </View>

        <View className="mb-6 flex-row flex-wrap justify-between">
          {actions.map((action, index) => (
            <ActionCard
              key={index}
              title={action.title}
              subtitle={action.subtitle}
              icon={action.icon}
              onPress={action.onPress}
              iconBackgroundColor={action.color}
            />
          ))}
        </View>

        <PromoBanner
          title="Get your Virtual Bank Account"
          description="Receive USD and EUR for USDC"
          onPress={() => showToast("Virtual Bank Account coming soon!")}
          onClose={() => {}}
        />

        {entries.length > 0 && (
          <View className="mt-6">
            <ThemedText type="subtitle" className="mb-4">
              Recent Activity
            </ThemedText>
            <TransactionList sections={sections} />
          </View>
        )}
      </ScrollView>
      <SendModal
        visible={isSendModalVisible}
        onClose={hideAllModals}
        onSendToWallet={() => {
          hideAllModals();
          sendFlowModalRef.current?.present();
        }}
      />

      <SendFlowModal ref={sendFlowModalRef} onClose={() => {}} />

      <ReceiveModal
        visible={isReceiveModalVisible}
        onClose={hideAllModals}
        onOpenQRCode={() => qrCodeModalRef.current?.present()}
      />

      <QRCodeModal ref={qrCodeModalRef} walletAddress={address ?? ""} />
    </ScreenLayout>
  );
}

export default function HomeScreen() {
  return <HomeScreenContent />;
}
