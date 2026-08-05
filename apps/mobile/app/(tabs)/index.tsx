import { View, ScrollView } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useRef } from "react";

import { ActionCard, PromoBanner } from "@/components/ui/molecules";
import { ScreenLayout } from "@/components/ui/layout";
import { SendModal } from "@/components/ui/organisms/modals/SendModal";
import { ReceiveModal } from "@/components/ui/organisms/modals/ReceiveModal";
import { QRCodeModal } from "@/components/ui/organisms/modals/QRCodeModal";
import { useModalFlow } from "@/contexts/ModalFlowContext";
import { useToast } from "@/contexts/ToastContext";
import { BalanceChart } from "@/components/ui/organisms/BalanceChart";
import { useBalanceDelta, useBalanceHistory } from "@/hooks/useBalanceHistory";
import { useEarnPosition } from "@/hooks/useEarn";
import { getUsdcMint } from "@/utils/cluster";
import { useBalances } from "@/hooks/useBalances";
import { useTransfersInfinite } from "@/hooks/useTransfers";
import { useWalletAddress } from "@/hooks/useWalletAddress";
import { useWalletName } from "@/hooks/useWalletName";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { useRouter } from "expo-router";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { SendFlowModal } from "@/components/ui/organisms/send/SendFlowModal";
import BalanceView from "@/components/BalanceView";
import { cn } from "@/utils/cn";
import type { BalanceDelta } from "@/utils/balanceDelta";

// Ionicons takes a colour value, not a class, so the tokens are resolved here.
const SUCCESS = "#34C759";
const DESTRUCTIVE = "#FF3B30";

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
    total,
    totalDisplay,
    tokens,
    usdc,
    isError: isBalanceError,
    refetch: refetchBalances,
  } = useBalances();
  const { balance: earnBalance } = useEarnPosition();
  const { isLoading } = useTransfersInfinite();
  const address = useWalletAddress();
  const { name: walletName } = useWalletName();
  const sendFlowModalRef = useRef<BottomSheetModal>(null);
  const qrCodeModalRef = useRef<BottomSheetModal>(null);

  const usdcMint = getUsdcMint();
  const hasOtherAssets = tokens.some(
    (t) => t.mint !== usdcMint && Number(t.amountRaw) > 0
  );

  const actions = useMemo(
    () => [
      {
        title: "Cash",
        subtitle: "Send and Receive",
        icon: require("@/assets/icons/usdc.png"),
        onPress: () => router.push("/cash"),
        color: "#007AFF", // Blue
        funded: usdc > 0,
      },
      {
        title: "Investments",
        subtitle: "Your other assets",
        icon: require("@/assets/icons/investment.png"),
        onPress: () => router.push("/investments"),
        color: "#FF9500", // Orange
        funded: hasOtherAssets,
      },
      {
        title: "Earn",
        subtitle: "Yield on your balance",
        icon: require("@/assets/icons/earn.png"),
        onPress: () => router.push("/earn"),
        color: "#AF52DE", // Purple
        funded: earnBalance > 0,
      },
      {
        title: "Xend Card",
        subtitle: "Get your free Card",
        icon: require("@/assets/icons/card.png"),
        onPress: () => showToast("Xend Card coming soon"),
        color: "#000000", // Black
        funded: false,
      },
    ],
    [router, showToast, usdc, hasOtherAssets, earnBalance]
  );

  const history = useBalanceHistory();
  const delta = useBalanceDelta(history);
  // The chart only earns its space once there is a balance to plot; a zero
  // balance gets the call to action instead.
  const hasBalance = total > 0;

  return (
    <ScreenLayout>
      <ScrollView
        contentContainerClassName="grow pb-[132px]"
        showsVerticalScrollIndicator={false}
      >
        <View>
          <TabHeaderText>{walletName}</TabHeaderText>

          <View>
            <View className="flex-row items-center gap-1.5">
              <Typography weight="500" className="text-sm text-black/30">
                Total Balance
              </Typography>
              {delta && <BalanceDeltaBadge delta={delta} />}
            </View>
            {isBalanceError ? (
              <HapticPressable
                className="flex-row items-center gap-1.5 self-start py-2"
                onPress={() => refetchBalances()}
              >
                <Typography
                  weight="700"
                  className="text-[40px] leading-[120%] tracking-[-1.1px]"
                >
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
                className="text-[40px] leading-[120%] tracking-[-1.1px]"
                amount={totalDisplay}
              />
            )}
          </View>

          {hasBalance ? (
            <BalanceChart history={history} className="mb-6 mt-8" />
          ) : (
            !isLoading && (
              <View className="items-center pb-6 pt-8">
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
            )
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
              funded={action.funded}
            />
          ))}
        </View>

        <PromoBanner
          title="Earn up to 4.93% APY"
          description="Put USDC into Earn"
          onPress={() => router.push("/earn")}
          onClose={() => {}}
        />
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

function BalanceDeltaBadge({ delta }: { delta: BalanceDelta }) {
  const flat = delta.fraction === 0;
  const up = delta.fraction > 0;
  return (
    <View className="flex-row items-center gap-0.5">
      <Ionicons
        name={flat ? "remove-circle" : up ? "trending-up" : "trending-down"}
        size={12}
        color={flat ? "#999" : up ? SUCCESS : DESTRUCTIVE}
      />
      <Typography
        weight="500"
        className={cn(
          "text-sm",
          flat ? "text-black/30" : up ? "text-success" : "text-destructive"
        )}
      >
        {delta.display}
      </Typography>
    </View>
  );
}

export default function HomeScreen() {
  return <HomeScreenContent />;
}
