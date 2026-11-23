import React from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { GlassButton } from "@/components/ui/atoms/Glass";
import { useAwaitingPayments } from "@/hooks/useAwaitingPayments";
import { formatMoney } from "@/utils/money";
import { requestApproval } from "@/utils/approvalRequests";
import { usePalette } from "@/hooks/usePalette";

/**
 * Every Payment a checkout handed to this phone, for when there is more than
 * one. Each opens the approval takeover, which is where they are answered.
 */
export default function FinishPaymentScreen() {
  const palette = usePalette();
  const { data: payments, isLoading, isError, refetch } = useAwaitingPayments();
  const waiting = payments ?? [];
  const startPayment = (payment: { reference: string }) =>
    requestApproval(payment.reference);

  return (
    <ScreenLayout>
      <View className="flex-1">
        <Typography weight="700" className="mt-6 text-3xl text-foreground">
          Finish your payment
        </Typography>
        <Typography
          weight="500"
          className="mt-2 text-base leading-6 text-foreground/40"
        >
          Payments this size are checked twice.{"\n"}The second check happens
          here.
        </Typography>

        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : isError ? (
          <View className="flex-1 items-center justify-center">
            <Typography
              weight="500"
              className="mb-3 text-base text-foreground/40"
            >
              Couldn&apos;t load your payments.
            </Typography>
            <HapticPressable onPress={() => refetch()} className="p-2">
              <Typography weight="600" className="text-base text-foreground">
                Retry
              </Typography>
            </HapticPressable>
          </View>
        ) : waiting.length === 0 ? (
          <View className="flex-1 items-center justify-center">
            <View className="mb-4 h-14 w-24 items-center justify-center rounded-full border-2 border-dashed border-foreground/15 bg-foreground/[0.03]">
              <Ionicons name="checkmark" size={22} color={palette.fg(0.2)} />
            </View>
            <Typography weight="700" className="text-lg text-foreground">
              Nothing waiting
            </Typography>
            <Typography
              weight="500"
              className="mt-1 text-base text-foreground/40"
            >
              Payments needing a second check appear here.
            </Typography>
          </View>
        ) : (
          <View className="mt-8 flex-1 gap-3">
            {waiting.map((payment) => (
              <View
                key={payment.reference}
                className="rounded-[20px] border border-foreground/[0.05] bg-card p-4"
              >
                <Typography weight="500" className="text-sm text-foreground/40">
                  {payment.merchantDisplayName}
                </Typography>
                <Typography
                  weight="700"
                  className="mt-1 text-3xl tabular-nums text-foreground"
                >
                  {formatMoney(
                    payment.displayCurrency,
                    payment.displayAmountMinor
                  )}
                </Typography>
                <Typography
                  weight="500"
                  className="mt-2 text-sm text-foreground/50"
                >
                  You pay {formatMoney("USDC", payment.usdcSettlementRaw)}
                  {"\n"}Quote expires at{" "}
                  {new Date(payment.expiresAt).toLocaleTimeString()}.
                </Typography>
                <HapticPressable
                  onPress={() => startPayment(payment)}
                  className="mt-4 w-full items-center justify-center rounded-full bg-primary py-4"
                >
                  <Typography
                    weight="600"
                    className="text-base text-primary-foreground"
                  >
                    Review
                  </Typography>
                </HapticPressable>
              </View>
            ))}
          </View>
        )}

        <View className="flex-row items-center justify-between">
          <GlassButton
            radius={999}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            className="h-14 w-14 items-center justify-center rounded-full"
            fallbackClassName="bg-card shadow-md shadow-black/10"
          >
            <Ionicons
              name="chevron-back"
              size={22}
              color={palette.foreground}
            />
          </GlassButton>
        </View>
      </View>
    </ScreenLayout>
  );
}
