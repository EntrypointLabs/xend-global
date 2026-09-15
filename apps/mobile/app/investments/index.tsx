import React, { useMemo, useRef, useState } from "react";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { Image, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import BalanceView from "@/components/BalanceView";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { ActionPill } from "@/components/ui/molecules/ActionPill";
import { Typography } from "@/components/ui/atoms/Typography";
import { ScreenLayout } from "@/components/ui/layout";
import { QRCodeModal } from "@/components/ui/organisms/modals/QRCodeModal";
import { ReceiveModal } from "@/components/ui/organisms/modals/ReceiveModal";
import { useModalFlow } from "@/contexts/ModalFlowContext";
import { useSendGate } from "@/hooks/useSendGate";
import { useWalletAddress } from "@/hooks/useWalletAddress";
import { useInvestments, type InvestmentHolding } from "@/hooks/useInvestments";
import { TokenMark } from "@/components/ui/atoms/TokenMark";
import { SendModal } from "@/components/ui/organisms/modals/SendModal";
import { SendFlowModal } from "@/components/ui/organisms/send/SendFlowModal";
import { formatMoney } from "@/utils/balances";
import { formatTokenAmount } from "@/utils/tokens";
import { cn } from "@/utils/cn";

/**
 * Investments: every token the Consumer holds that is not their spending
 * balance. Nothing to opt into, so the screen is a read of what they already
 * own rather than a product surface.
 */
export default function InvestmentsScreen() {
  const router = useRouter();
  const { showReceiveModal, isReceiveModalVisible, hideAllModals } =
    useModalFlow();
  const address = useWalletAddress();
  const gateSend = useSendGate();
  const qrCodeModalRef = useRef<BottomSheetModal>(null);
  const sendFlowModalRef = useRef<BottomSheetModal>(null);
  const [isSendModalVisible, setIsSendModalVisible] = useState(false);
  const { holdings, totalUsd, isEmpty, isError } = useInvestments();

  const actionItems = useMemo(
    () => [
      {
        icon: () => (
          <View className="flex-row items-center gap-2">
            <Ionicons name="swap-horizontal" size={20} color="black" />
            <Typography weight="700" className="text-lg">
              Swap
            </Typography>
          </View>
        ),
        onPress: () => router.push("/swap"),
        accessibilityLabel: "Swap",
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
        onPress: () => gateSend(() => setIsSendModalVisible(true)),
        accessibilityLabel: "Send",
      },
    ],
    [router, gateSend]
  );

  const total = isError ? "0.00" : formatMoney(totalUsd);

  return (
    <ScreenLayout>
      <View className="flex-row items-center gap-3">
        <Image
          source={require("@/assets/icons/investment.png")}
          className="h-9 w-9 rounded-xl"
        />
        <Typography variant="title2" weight="600">
          Investments
        </Typography>
      </View>

      <View className="mt-6">
        <Typography variant="body" className="text-black/40">
          Balance
        </Typography>
        <BalanceView variant="h3" weight="700" amount={total} />
      </View>

      {isEmpty ? (
        <EmptyState onGetAssets={showReceiveModal} />
      ) : (
        <ScrollView
          className="mt-6 flex-1"
          contentContainerClassName="gap-3 pb-28"
          showsVerticalScrollIndicator={false}
        >
          {holdings.map((holding) => (
            <HoldingRow key={holding.mint} holding={holding} />
          ))}
        </ScrollView>
      )}

      <View className="absolute bottom-2 left-5 right-5 flex-row items-center justify-between">
        <HapticPressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          className="h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm"
        >
          <Ionicons name="chevron-back" size={22} color="#000" />
        </HapticPressable>

        {/* Only offered once there is something to act on. */}
        {!isEmpty && <ActionPill items={actionItems} />}
      </View>

      {/* Mounted here, not just triggered: ModalFlowContext only holds
          visibility, so a screen that does not render these shows nothing when
          Send is tapped. */}
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
        onClose={hideAllModals}
        onOpenQRCode={() => qrCodeModalRef.current?.present()}
      />
      <QRCodeModal ref={qrCodeModalRef} walletAddress={address ?? ""} />
    </ScreenLayout>
  );
}

function EmptyState({ onGetAssets }: { onGetAssets: () => void }) {
  return (
    <View className="flex-1 items-center justify-center gap-2">
      <View className="mb-4 h-16 w-28 flex-row items-center gap-2 rounded-2xl border-2 border-dashed border-black/10 px-4">
        <View className="h-7 w-7 rounded-full bg-black/5" />
        <View className="gap-1">
          <View className="h-2 w-10 rounded-full bg-black/5" />
          <View className="h-2 w-6 rounded-full bg-black/5" />
        </View>
      </View>

      <Typography variant="title2" weight="600">
        There is nothing here yet
      </Typography>
      <Typography variant="body" className="text-black/40">
        Deposit or swap tokens
      </Typography>

      <HapticPressable
        accessibilityRole="button"
        accessibilityLabel="Get assets"
        onPress={onGetAssets}
        className="mt-5 flex-row items-center gap-2 rounded-full bg-black px-5 py-3"
      >
        <Ionicons name="arrow-down-circle" size={18} color="#fff" />
        <Typography variant="body" weight="600" className="text-white">
          Get Assets
        </Typography>
      </HapticPressable>
    </View>
  );
}

function HoldingRow({ holding }: { holding: InvestmentHolding }) {
  const change = holding.priceChange24h;

  return (
    <View className="flex-row items-center justify-between py-2">
      <View className="flex-row items-center gap-3">
        <TokenMark
          mint={holding.mint}
          label={holding.name}
          iconUrl={holding.iconUrl}
        />
        <View className="gap-0.5">
          <Typography variant="body" weight="600">
            {holding.name}
          </Typography>
          <Typography variant="body" className="text-black/30">
            {formatTokenAmount(holding.amount, holding.decimals)}
            {holding.symbol ? ` ${holding.symbol}` : ""}
          </Typography>
        </View>
      </View>

      <View className="items-end gap-0.5">
        {holding.usdValue == null ? (
          // Nothing could price it. Saying so beats printing a "$0.00" the
          // Consumer would read as having lost it.
          <Typography variant="body" weight="600" className="text-black/30">
            Unpriced
          </Typography>
        ) : (
          <BalanceView weight="600" amount={formatMoney(holding.usdValue)} />
        )}
        {change != null && (
          <Typography
            weight="500"
            className={cn(
              "text-sm",
              change > 0
                ? "text-success"
                : change < 0
                  ? "text-destructive"
                  : "text-black/30"
            )}
          >
            {change > 0 ? "+" : ""}
            {change.toFixed(2)}%
          </Typography>
        )}
      </View>
    </View>
  );
}
