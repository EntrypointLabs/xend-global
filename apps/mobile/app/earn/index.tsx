import React, { useRef } from "react";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { Image, ScrollView, View } from "react-native";
import { usePaneNavigation } from "@/contexts/OverlayPaneContext";
import { Ionicons } from "@expo/vector-icons";

import { useFeature } from "@/hooks/useFeature";
import { usePalette } from "@/hooks/usePalette";
import { cn } from "@/utils/cn";
import BalanceView from "@/components/BalanceView";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { GlassButton, GlassSurface } from "@/components/ui/atoms/Glass";
import { Typography } from "@/components/ui/atoms/Typography";
import { ScreenLayout } from "@/components/ui/layout";
import { QRCodeModal } from "@/components/ui/organisms/modals/QRCodeModal";
import { ReceiveModal } from "@/components/ui/organisms/modals/ReceiveModal";
import { useModalFlow } from "@/contexts/ModalFlowContext";
import { useWalletAddress } from "@/hooks/useWalletAddress";
import { EARN_PRODUCTS, useEarnPosition } from "@/hooks/useEarn";

/**
 * Earn: yield on the Consumer's spending balance.
 *
 * Deposits are not wired yet, so the screen shows a real zero position and the
 * products actually on offer rather than a "coming soon" wall. The numbers are
 * the Consumer's own, so they stay honest as soon as deposits land.
 */
export default function EarnScreen() {
  const pane = usePaneNavigation();
  const palette = usePalette();
  const depositsEnabled = useFeature("earnDeposits");
  const { showReceiveModal, isReceiveModalVisible, hideAllModals } =
    useModalFlow();
  const address = useWalletAddress();
  const qrCodeModalRef = useRef<BottomSheetModal>(null);
  const { balanceDisplay, apyDisplay, lifetimeEarned, lastSevenDays } =
    useEarnPosition();

  return (
    <ScreenLayout>
      <View className="flex-row items-center gap-3">
        <Image
          source={require("@/assets/icons/earn.png")}
          className="h-9 w-9 rounded-xl"
        />
        <Typography variant="title2" weight="600">
          Earn
        </Typography>
      </View>

      <View className="mt-6">
        <View className="flex-row items-center gap-2">
          <Typography variant="body" className="text-foreground/40">
            Balance
          </Typography>
          <Typography variant="body" className="text-foreground/20">
            •
          </Typography>
          <Typography variant="body" className="text-foreground/40">
            APY {apyDisplay}
          </Typography>
        </View>
        <BalanceView
          rolling
          variant="h3"
          weight="700"
          amount={balanceDisplay}
        />
      </View>

      <View className="mt-6 flex-row gap-3">
        <StatCard
          icon="sparkles"
          label="Lifetime Earned"
          amount={lifetimeEarned}
        />
        <StatCard icon="calendar" label="Last 7D" amount={lastSevenDays} />
      </View>

      <View className="mb-3 mt-8 flex-row items-baseline justify-between">
        <Typography variant="body" weight="600">
          Available products
        </Typography>
        <Typography variant="caption" className="text-foreground/40">
          Routed to Kamino
        </Typography>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3 pb-28"
        showsVerticalScrollIndicator={false}
      >
        {EARN_PRODUCTS.map((product) => (
          <View
            key={product.id}
            className="rounded-2xl bg-foreground/[0.03] px-4 py-4"
          >
            <View className="flex-row items-center gap-3">
              <View
                className={cn(
                  "h-11 w-11 items-center justify-center overflow-hidden rounded-2xl",
                  !product.icon && "bg-primary/80"
                )}
              >
                {product.icon ? (
                  <Image source={product.icon} className="h-11 w-11" />
                ) : (
                  <Typography
                    variant="body"
                    weight="700"
                    className="text-primary-foreground"
                  >
                    {product.provider.slice(0, 1)}
                  </Typography>
                )}
              </View>
              <View className="flex-1">
                <View className="flex-row items-center gap-1">
                  <Typography variant="body" className="text-foreground/40">
                    {product.provider}
                  </Typography>
                  <Typography variant="body" className="text-foreground/20">
                    •
                  </Typography>
                  <Typography
                    variant="body"
                    weight="600"
                    className="text-success"
                  >
                    {product.apyDisplay} APY
                  </Typography>
                </View>
                <Typography variant="title2" weight="600">
                  {product.name}
                </Typography>
              </View>
            </View>
            <Typography variant="body" className="mt-3 text-foreground/40">
              {product.description}
            </Typography>
          </View>
        ))}
      </ScrollView>

      <View className="absolute bottom-2 left-5 right-5 flex-row items-center gap-3">
        <GlassButton
          radius={999}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={pane.back}
          className="h-14 w-14 items-center justify-center rounded-full"
        >
          <Ionicons name="chevron-back" size={22} color={palette.foreground} />
        </GlassButton>

        <GlassSurface
          radius={999}
          className="ml-auto flex-row items-center gap-6 rounded-full px-6 py-4"
        >
          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel="Deposit into Earn"
            // Opening Receive would fund the wallet, not the position, which
            // is not what a control labelled Deposit promises.
            disabled={!depositsEnabled}
            onPress={depositsEnabled ? showReceiveModal : () => {}}
            className={cn(
              "flex-row items-center gap-2",
              !depositsEnabled && "opacity-30"
            )}
          >
            <Ionicons name="add" size={18} color={palette.foreground} />
            <Typography variant="body" weight="600">
              Deposit
            </Typography>
          </HapticPressable>

          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel="Withdraw from Earn"
            // Disabled rather than hidden: a zero position should still show
            // the Consumer that withdrawing is how they get out.
            disabled
            onPress={() => {}}
            className="flex-row items-center gap-2 opacity-30"
          >
            <Ionicons name="arrow-up" size={18} color={palette.foreground} />
            <Typography variant="body" weight="600">
              Withdraw
            </Typography>
          </HapticPressable>
        </GlassSurface>
      </View>

      <ReceiveModal
        visible={isReceiveModalVisible}
        onClose={hideAllModals}
        onOpenQRCode={() => qrCodeModalRef.current?.present()}
      />
      <QRCodeModal ref={qrCodeModalRef} walletAddress={address ?? ""} />
    </ScreenLayout>
  );
}

function StatCard({
  icon,
  label,
  amount,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  amount: string;
}) {
  const palette = usePalette();
  return (
    <View className="flex-1 gap-6 rounded-2xl bg-foreground/[0.03] px-4 py-4">
      <View className="flex-row items-center gap-2">
        <Ionicons name={icon} size={15} color={palette.fg(0.75)} />
        <Typography variant="body" weight="600">
          {label}
        </Typography>
      </View>
      <BalanceView variant="title2" weight="600" amount={amount} />
    </View>
  );
}
