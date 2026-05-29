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
import { useWalletQuery } from "@/queries/useWalletQuery";
import { useBalancesQuery } from "@/queries/useBalancesQuery";
import { useTransactionsQuery } from "@/queries/useTransactionsQuery";
import { useWalletName } from "@/hooks/useWalletName";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { useRouter } from "expo-router";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { SendFlowModal } from "@/components/ui/organisms/send/SendFlowModal";
import BalanceView from "@/components/BalanceView";
import { groupByDate } from "@/utils/groupByDate";

function HomeScreenContent() {
  const router = useRouter();
  const {
    showReceiveModal,
    isReceiveModalVisible,
    hideAllModals,
    isSendModalVisible,
  } = useModalFlow();
  const { showToast } = useToast();

  // Wire-real-backend Phase 5: consume real backend via TanStack-Query hooks.
  // Adapter handles DB+Grid dedupe and self-send filtering; this screen just
  // groups by day and feeds the existing TransactionList.
  const walletQuery = useWalletQuery();
  const balancesQuery = useBalancesQuery();
  const gridAccountId = walletQuery.data?.gridAccountId ?? "";
  const transactionsQuery = useTransactionsQuery({ gridAccountId });
  
  // console.log("infoAboutUser", balancesQuery)

  const balance = balancesQuery.data?.usdc ?? 0;
  const transactions = transactionsQuery.data ?? [];

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
        subtitle: "Trade Crypto",
        icon: require("@/assets/icons/investment.png"),
        onPress: () => showToast("Coming soon"),
        color: "#FF9500", // Orange
      },
      {
        title: "Earn",
        subtitle: "Up to 7.99% APY",
        icon: require("@/assets/icons/earn.png"),
        onPress: () => showToast("Coming soon"),
        color: "#AF52DE", // Purple
      },
      {
        title: "Xend Card",
        subtitle: "Get your free Card",
        icon: require("@/assets/icons/card.png"),
        onPress: () => showToast("Coming soon"),
        color: "#000000", // Black
      },
    ],
    [showToast, router]
  );

  const groups = useMemo(() => groupByDate(transactions), [transactions]);

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
            <BalanceView
              weight="700"
              className="text-[40px] leading-[140%]"
              amount={balance.toString()}
            />
          </View>

          {transactions.length === 0 && (
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

        {transactions.length > 0 && (
          <View className="mt-6">
            <ThemedText type="subtitle" className="mb-4">
              Recent Activity
            </ThemedText>
            <TransactionList transactions={groups} />
          </View>
        )}
      </ScrollView>
      <SendModal
        visible={isSendModalVisible}
        onClose={hideAllModals}
        onSendToWallet={() => {
          hideAllModals();
          // Short delay to allow animation to start closing before opening new one
          // or just open it. ActionModal handles mounting.
          setTimeout(() => sendFlowModalRef.current?.present(), 100);
        }}
      />

      <SendFlowModal ref={sendFlowModalRef} onClose={() => {}} />

      <ReceiveModal
        visible={isReceiveModalVisible}
        onClose={hideAllModals}
        onOpenQRCode={() => qrCodeModalRef.current?.present()}
      />

      <QRCodeModal ref={qrCodeModalRef} walletAddress={gridAccountId} />
    </ScreenLayout>
  );
}

export default function HomeScreen() {
  return <HomeScreenContent />;
}
