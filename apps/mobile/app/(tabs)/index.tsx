import { View } from "react-native";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { Typography } from "@/components/ui/atoms/Typography";
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useRef } from "react";

import { ActionCard, PromoBanner } from "@/components/ui/molecules";
import { ScreenLayout } from "@/components/ui/layout";
import { SendModal } from "@/components/ui/organisms/modals/SendModal";
import { ReceiveModal } from "@/components/ui/organisms/modals/ReceiveModal";
import { QRCodeModal } from "@/components/ui/organisms/modals/QRCodeModal";
import { useModalFlow } from "@/contexts/ModalFlowContext";
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

// The tab bar and the send button float over the content, anchored at
// `insets.bottom + 8` from the screen edge and 50pt tall. ScreenLayout's
// SafeAreaView has already inset the bottom, so only the part above that inset
// is ours to clear; adding insets.bottom again double-counts it.
const FLOATING_CHROME_HEIGHT = 8 + 50;
// ScreenLayout's own p-5 already sits below this, so the measured gap to the
// chrome is comfortably larger than this number suggests.
const CHROME_GAP = 4;

// The spacing the screen was drawn with, in points, before it was made
// scalable: `mt-8` above the chart and `mb-6` below each block.
const CHART_GAP_ABOVE = 28;
const SECTION_GAP = 21;

function HomeScreenContent() {
  const router = useRouter();
  const { size, typeSize, compact } = useResponsiveLayout();
  const {
    showReceiveModal,
    isReceiveModalVisible,
    hideAllModals,
    isSendModalVisible,
  } = useModalFlow();
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
        subtitle: "Send and receive",
        icon: require("@/assets/icons/usdc.png"),
        onPress: () => router.push("/cash"),
        color: "#007AFF", // Blue
        funded: usdc > 0,
      },
      {
        title: "Investments",
        subtitle: "Trade crypto",
        icon: require("@/assets/icons/investment.png"),
        onPress: () => router.push("/investments"),
        color: "#FF9500", // Orange
        funded: hasOtherAssets,
      },
      {
        title: "Earn",
        subtitle: "Up to 4.93% APY",
        icon: require("@/assets/icons/earn.png"),
        onPress: () => router.push("/earn"),
        color: "#AF52DE", // Purple
        funded: earnBalance > 0,
      },
      {
        title: "Xend Card",
        subtitle: "Get your free Card",
        icon: require("@/assets/icons/card.png"),
        onPress: () => router.push("/card?from=/(tabs)" as never),
        color: "#000000", // Black
        funded: false,
      },
    ],
    [router, usdc, hasOtherAssets, earnBalance]
  );

  const history = useBalanceHistory();
  const delta = useBalanceDelta(history);
  // The chart only earns its space once there is a balance to plot; a zero
  // balance gets the call to action instead.
  const hasBalance = total > 0;

  return (
    <ScreenLayout>
      <View
        className="flex-1"
        style={{ paddingBottom: FLOATING_CHROME_HEIGHT + CHROME_GAP }}
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
                  className="leading-[120%] tracking-[-1.1px]"
                  style={{ fontSize: size(40) }}
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
                className="leading-[120%] tracking-[-1.1px]"
                style={{ fontSize: size(40) }}
                amount={totalDisplay}
              />
            )}
          </View>
        </View>

        {hasBalance ? (
          <BalanceChart
            history={history}
            style={{
              marginTop: size(CHART_GAP_ABOVE),
              marginBottom: size(SECTION_GAP),
            }}
          />
        ) : (
          !isLoading && (
            <View
              className="items-center"
              style={{
                paddingTop: size(20),
                paddingBottom: size(8),
                marginBottom: size(SECTION_GAP),
              }}
            >
              <Typography
                weight="600"
                className="text-center"
                style={{
                  fontSize: typeSize(compact ? 17 : 19),
                  marginBottom: compact ? 2 : size(6),
                }}
              >
                There is nothing here yet
              </Typography>
              <Typography
                weight="500"
                className="max-w-[250px] text-center text-black/30"
                style={{
                  fontSize: typeSize(14),
                  marginBottom: compact ? 6 : size(14),
                }}
              >
                Deposit tokens to your address and start using Xend Wallet
              </Typography>

              <HapticPressable
                className="flex-row items-center gap-0.5 rounded-full bg-black px-3"
                style={{ paddingVertical: size(compact ? 8 : 10) }}
                onPress={showReceiveModal}
              >
                <Ionicons
                  name="arrow-down-circle"
                  size={size(18)}
                  color="white"
                />
                <Typography
                  weight="500"
                  className="text-white"
                  style={{ fontSize: typeSize(16) }}
                >
                  Receive
                </Typography>
              </HapticPressable>
            </View>
          )
        )}

        <View
          className="flex-row flex-wrap justify-between"
          style={{ marginBottom: size(SECTION_GAP) }}
        >
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

        {/* Every gap above is fixed, so the leftover height lands here. A taller
            phone gets more room between the banner and the tab bar rather than
            a void opening up mid-screen. */}
        <View className="flex-1" />
      </View>
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
