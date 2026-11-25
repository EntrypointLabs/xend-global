import { useExecuteEarn } from "@/hooks/useExecuteEarn";
import React, { useState } from "react";
import {
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Slider } from "@expo/ui/community/slider";
import { Ionicons } from "@expo/vector-icons";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Stop,
  Line,
  Rect,
} from "react-native-svg";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { FrostBlurView } from "@/components/ui/atoms/FrostBlurView";
import { Typography } from "@/components/ui/atoms/Typography";
import { usePalette } from "@/hooks/usePalette";
import { showToast } from "@/utils/toast";
import type { EarnProduct } from "@/hooks/useEarn";
import { formatEarnMoney, projectedValue } from "@/utils/earnProjection";

export type EarnFlowState =
  | { step: "choose" | "choose-withdraw" }
  | { step: "info" | "deposit" | "withdraw"; productId: string };
type Props = {
  flow: EarnFlowState | null;
  products: EarnProduct[];
  available: number;
  positionBalances: Record<string, number>;
  balanceReady: boolean;
  depositsEnabled: boolean;
  onChange: (flow: EarnFlowState | null) => void;
};

export function EarnFlow(props: Props) {
  const palette = usePalette();
  const { height } = useWindowDimensions();
  const flow = props.flow;
  const product =
    flow && "productId" in flow
      ? props.products.find((p) => p.id === flow.productId)
      : undefined;
  const fullScreen = flow?.step === "deposit" || flow?.step === "withdraw";
  return (
    <Modal
      visible={!!flow}
      transparent
      animationType="fade"
      onRequestClose={() => props.onChange(null)}
    >
      {fullScreen && product ? (
        <DepositScreen
          key={`${flow.step}:${product.id}`}
          {...props}
          product={product}
          withdraw={flow.step === "withdraw"}
        />
      ) : (
        <View className="flex-1 justify-end">
          <View className="absolute inset-0">
            <FrostBlurView
              tint={palette.dark ? "dark" : "light"}
              className="flex-1"
            />
          </View>
          <Pressable
            accessibilityLabel="Dismiss"
            onPress={() => props.onChange(null)}
            className="absolute inset-0 bg-black/10"
          />
          <View
            accessibilityViewIsModal
            className="mx-3 mb-7 overflow-hidden rounded-[32px] bg-card px-5 pb-5 pt-6"
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              // MEASURED-LAYOUT: the reference sheet scrolls only on smaller devices.
              style={{ maxHeight: height - 150 }}
            >
              {product && flow?.step === "info" ? (
                <Discovery
                  product={product}
                  onDeposit={() =>
                    props.onChange({ step: "deposit", productId: product.id })
                  }
                  onClose={() => props.onChange(null)}
                />
              ) : (
                <>
                  <CloseButton onPress={() => props.onChange(null)} />
                  <View className="items-center pb-7 pt-1">
                    <View className="mb-4 h-12 w-12 items-center justify-center rounded-full bg-foreground/[0.02]">
                      <Ionicons
                        name="information-circle-outline"
                        size={25}
                        color={palette.foreground}
                      />
                    </View>
                    <Typography variant="title1" weight="600">
                      {flow?.step === "choose-withdraw"
                        ? "Withdraw"
                        : "Deposit"}
                    </Typography>
                    <Typography
                      variant="title2"
                      className="mt-1 text-foreground/30"
                    >
                      Choose product
                    </Typography>
                  </View>
                  {props.products.map((p) => (
                    <HapticPressable
                      key={p.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${p.provider} ${p.name}`}
                      disabled={
                        flow?.step === "choose-withdraw" &&
                        !(props.positionBalances[p.id] > 0)
                      }
                      onPress={() =>
                        props.onChange({
                          step:
                            flow?.step === "choose-withdraw"
                              ? "withdraw"
                              : "deposit",
                          productId: p.id,
                        })
                      }
                      className="flex-row items-center gap-3 pb-2 pt-3"
                    >
                      <ProviderIcon product={p} />
                      <View className="flex-1">
                        <Typography variant="title2" weight="600">
                          {p.name}
                        </Typography>
                        <View className="mt-1 flex-row items-center gap-1">
                          <Typography
                            variant="body"
                            className="text-foreground/30"
                          >
                            {p.provider} ·{" "}
                          </Typography>
                          <Typography variant="body" className="text-success">
                            {p.apy === null ? "Rate unavailable" : p.apyDisplay}
                          </Typography>
                          {p.apy !== null && (
                            <Typography
                              variant="body"
                              className="text-foreground/30"
                            >
                              {p.simulated ? "Simulated APY" : "APY"}
                            </Typography>
                          )}
                        </View>
                      </View>
                      <Image
                        source={require("@/assets/icons/usdc.png")}
                        className="h-6 w-6"
                      />
                    </HapticPressable>
                  ))}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      )}
    </Modal>
  );
}

function CloseButton({ onPress }: { onPress: () => void }) {
  const palette = usePalette();
  return (
    <HapticPressable
      accessibilityRole="button"
      accessibilityLabel="Close"
      onPress={onPress}
      className="absolute right-0 top-0 z-10 h-9 w-9 items-center justify-center"
    >
      <Ionicons name="close" size={26} color={palette.fg(0.25)} />
    </HapticPressable>
  );
}
export function ProviderIcon({ product }: { product: EarnProduct }) {
  return product.icon ? (
    <Image source={product.icon} className="h-11 w-11 rounded-xl" />
  ) : (
    <View className="h-11 w-11 items-center justify-center rounded-xl bg-foreground/5">
      <Typography weight="600">J</Typography>
    </View>
  );
}

function Discovery({
  product,
  onDeposit,
  onClose,
}: {
  product: EarnProduct;
  onDeposit: () => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  const end =
    product.apy === null ? null : projectedValue(1000, product.apy, 1);
  const currentYear = new Date().getFullYear();
  return (
    <View>
      <CloseButton onPress={onClose} />
      <View className="mb-5 items-center gap-1 pt-1">
        <Typography variant="title1" weight="600">
          {product.name}
        </Typography>
        <View className="flex-row items-center gap-2">
          <Typography variant="body" className="text-foreground/30">
            Provided by
          </Typography>
          {product.icon ? (
            <Image source={product.icon} className="h-4 w-4 rounded" />
          ) : (
            <Typography variant="caption">J</Typography>
          )}
          <Typography variant="body" weight="600">
            {product.provider}
          </Typography>
        </View>
      </View>
      <View className="rounded-[24px] border border-foreground/5 bg-foreground/[0.01] p-5">
        <View className="flex-row items-center justify-between gap-2 pb-4">
          <Typography variant="body" weight="600">
            How it works
          </Typography>
          <View className="rounded-full border border-foreground/10 bg-foreground/5 px-2 py-1">
            <Typography variant="caption">
              {product.apy === null
                ? "Rate unavailable"
                : `${product.apyDisplay} ${product.simulated ? "Simulated APY" : "APY"}`}
            </Typography>
          </View>
        </View>
        <View className="flex-row items-center justify-between border-y border-dashed border-foreground/10 py-4">
          <Typography variant="body" className="text-foreground/30">
            You Deposit
          </Typography>
          <View className="flex-row items-center gap-2">
            <Typography variant="title2" weight="600">
              $1,000.00
            </Typography>
            <Image
              source={require("@/assets/icons/usdc.png")}
              className="h-4 w-4"
            />
          </View>
        </View>
        <Typography variant="body" weight="600" className="mb-4 mt-4">
          Your potential earn
        </Typography>
        <View className="mb-4 flex-row justify-between">
          <View>
            <Typography variant="caption">{currentYear}</Typography>
            <Typography variant="body" className="text-foreground/30">
              $1,000.00
            </Typography>
          </View>
          <View className="items-end">
            <Typography variant="caption">{currentYear + 1}</Typography>
            <Typography variant="body" weight="600">
              {end === null ? "—" : formatEarnMoney(end)} ↗
            </Typography>
          </View>
        </View>
        <Svg
          width="100%"
          height={108}
          viewBox="0 0 300 108"
          preserveAspectRatio="none"
        >
          {Array.from({ length: 12 }, (_, i) => (
            <Rect
              key={i}
              x={i * 25}
              y={104 - (i + 1) * 8}
              width={19}
              height={(i + 1) * 8}
              rx={6}
              fill={palette.primary}
              opacity={i === 11 ? 1 : 0.08}
            />
          ))}
        </Svg>
      </View>
      <Typography
        variant="body"
        className="mb-3 mt-4 text-center text-foreground/30"
      >
        Deposit your dollars with {product.provider}
        {"\n"}to earn interest.
      </Typography>
      <HapticPressable
        accessibilityRole="link"
        onPress={() => {
          void Linking.openURL(product.learnMoreUrl);
        }}
        className="mb-5 flex-row items-center justify-center gap-2"
      >
        <Ionicons name="globe-outline" size={18} color={palette.foreground} />
        <Typography variant="body">Learn more</Typography>
      </HapticPressable>
      <HapticPressable
        accessibilityRole="button"
        onPress={onDeposit}
        className="items-center rounded-full bg-primary py-4"
      >
        <Typography
          variant="title2"
          weight="600"
          className="text-primary-foreground"
        >
          Deposit
        </Typography>
      </HapticPressable>
    </View>
  );
}

function DepositScreen({
  product,
  withdraw,
  available,
  positionBalances,
  balanceReady,
  depositsEnabled,
  onChange,
}: Props & { product: EarnProduct; withdraw: boolean }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const execution = useExecuteEarn();
  const limit = withdraw ? (positionBalances[product.id] ?? 0) : available;
  const [message, setMessage] = useState<string | null>(null);
  const move = async () => {
    setMessage(null);
    const wasPending = execution.hasPending;
    const result = await execution.execute(
      product.id,
      withdraw ? "redeem" : "deposit",
      amount,
      withdraw && amount === limit
    );
    if (result.status === "confirmed") {
      showToast(
        wasPending ? "Confirmed" : withdraw ? "Withdrawn" : "Deposited",
        <Ionicons name="checkmark-circle" size={16} className="text-success" />,
        { tone: "success" }
      );
      onChange(null);
    } else if (result.status === "pending")
      setMessage(
        "Your approval is saved. Check its status before trying another amount."
      );
    else if (result.status === "failed") setMessage(result.message);
  };
  const [chosen, setChosen] = useState(Math.min(1000, limit));
  const [years, setYears] = useState(10);
  const amount = Math.min(chosen, limit);
  const canMove =
    execution.ready &&
    (execution.hasPending ||
      (execution.configured &&
        (withdraw
          ? !!product.withdrawAvailable
          : !!product.available && depositsEnabled) &&
        balanceReady &&
        !product.simulated &&
        amount > 0));
  const estimated =
    product.apy === null ? null : projectedValue(amount, product.apy, years);
  return (
    <View
      accessibilityViewIsModal
      className="flex-1 bg-background px-6"
      // MEASURED-LAYOUT: safe-area spacing keeps the fixed CTA above the home indicator.
      style={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }}
    >
      <View className="mb-6 flex-row items-center justify-between">
        <HapticPressable
          accessibilityRole="button"
          accessibilityLabel="Back to products"
          disabled={execution.isExecuting}
          onPress={() =>
            onChange({ step: withdraw ? "choose-withdraw" : "choose" })
          }
          className="h-10 w-10 items-center justify-center rounded-full bg-foreground/5"
        >
          <Ionicons name="chevron-back" size={20} color={palette.foreground} />
        </HapticPressable>
        <Typography variant="body" weight="600">
          {withdraw ? "Withdraw" : "Deposit"}
        </Typography>
        <HapticPressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          disabled={execution.isExecuting}
          onPress={() => onChange(null)}
          className="h-10 w-10 items-center justify-center rounded-full bg-foreground/5"
        >
          <Ionicons name="close" size={19} color={palette.foreground} />
        </HapticPressable>
      </View>
      <View className="items-center">
        <Typography variant="caption" className="text-foreground/40">
          {withdraw
            ? "You receive"
            : product.apy === null
              ? "Rate unavailable"
              : `Start Earning ${product.apyDisplay} ⓘ`}
        </Typography>
        <Typography
          variant="h2"
          weight="700"
          className="mt-2"
          accessibilityLiveRegion="polite"
        >
          {withdraw
            ? formatEarnMoney(amount)
            : estimated === null
              ? "—"
              : formatEarnMoney(estimated)}
        </Typography>
        <Typography variant="caption" className="mt-1 text-foreground/40">
          {withdraw
            ? `From ${product.provider}`
            : `Estimated Value in ${years} ${years === 1 ? "Year" : "Years"}`}
        </Typography>
        {product.simulated && (
          <Typography variant="caption" className="mt-1 text-foreground/30">
            Illustrative estimate
          </Typography>
        )}
      </View>
      <View className="mb-8 mt-9 flex-1">
        {!withdraw && (
          <ProjectionChart
            apy={product.apy}
            amount={amount}
            years={years}
            onYears={setYears}
          />
        )}
        {!withdraw && (
          <View className="mt-3 flex-row justify-between">
            <Typography variant="caption" className="text-foreground/35">
              Today
            </Typography>
            <Typography variant="caption" className="text-foreground/35">
              30Y
            </Typography>
          </View>
        )}
      </View>
      <View className="items-center pb-3">
        <Typography variant="caption" className="text-foreground/40">
          {withdraw ? "Withdrawal amount" : "Initial Deposit"}
        </Typography>
        <Typography variant="title1" weight="600" className="mt-1">
          {formatEarnMoney(amount)}
        </Typography>
      </View>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={withdraw ? "Withdrawal amount" : "Initial deposit"}
        accessibilityValue={{
          min: 0,
          max: limit,
          now: amount,
          text: formatEarnMoney(amount),
        }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={({ nativeEvent }) =>
          setChosen(
            Math.min(
              limit,
              Math.max(
                0,
                amount + (nativeEvent.actionName === "increment" ? 1 : -1)
              )
            )
          )
        }
      >
        <Slider
          value={amount}
          minimumValue={0}
          maximumValue={Math.max(limit, 0.01)}
          step={0.01}
          disabled={
            execution.isExecuting ||
            execution.hasPending ||
            !balanceReady ||
            limit <= 0
          }
          onValueChange={(value) =>
            setChosen(value >= limit - 0.01 ? limit : value)
          }
          minimumTrackTintColor={palette.primary}
          maximumTrackTintColor={palette.fg(0.1)}
        />
      </View>
      <Typography
        variant="caption"
        className="mb-4 mt-3 text-center text-foreground/35"
      >
        {balanceReady
          ? `${formatEarnMoney(limit)} available`
          : "Balance unavailable"}{" "}
        · Returns vary
      </Typography>
      <HapticPressable
        accessibilityRole="button"
        accessibilityState={{
          disabled: !canMove || execution.isExecuting,
          busy: execution.isExecuting,
        }}
        disabled={!canMove || execution.isExecuting}
        onPress={() => {
          void move();
        }}
        className="items-center rounded-full bg-primary py-4"
      >
        <Typography
          variant="body"
          weight="600"
          className="text-primary-foreground"
        >
          {execution.isExecuting
            ? "Checking…"
            : execution.hasPending
              ? "Check previous approval"
              : withdraw
                ? "Withdraw"
                : "Add Money"}
        </Typography>
      </HapticPressable>
      <Typography
        variant="caption"
        className="mt-2 text-center text-foreground/35"
      >
        {message ??
          (execution.hasPending
            ? "A previous approval is still being checked"
            : !depositsEnabled
              ? "Temporarily unavailable"
              : !(withdraw ? product.withdrawAvailable : product.available) ||
                  !execution.configured
                ? "Not available yet"
                : "Rates vary. Network fees are covered.")}
      </Typography>
    </View>
  );
}

function ProjectionChart({
  apy,
  amount,
  years,
  onYears,
}: {
  apy: number | null;
  amount: number;
  years: number;
  onYears: (years: number) => void;
}) {
  const palette = usePalette();
  const [width, setWidth] = useState(300);
  const principal = Math.max(amount, 1);
  const rate = apy ?? 0;
  const end = projectedValue(principal, rate, 30);
  const base = principal * 0.6;
  const y = (year: number) =>
    280 - (260 * (projectedValue(principal, rate, year) - base)) / (end - base);
  const points = Array.from(
    { length: 121 },
    (_, i) => `${8 + (i / 120) * 284},${y(i / 4)}`
  );
  const path = `M${points.join(" L")}`;
  const x = 8 + (years / 30) * 284;
  const select = (locationX: number) =>
    onYears(
      Math.max(
        1,
        Math.min(30, Math.round((((locationX / width) * 300 - 8) / 284) * 30))
      )
    );
  return (
    <View
      className="flex-1"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Projection time horizon"
      accessibilityValue={{
        min: 1,
        max: 30,
        now: years,
        text: `${years} years`,
      }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={({ nativeEvent }) =>
        onYears(
          Math.max(
            1,
            Math.min(
              30,
              years + (nativeEvent.actionName === "increment" ? 1 : -1)
            )
          )
        )
      }
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => select(e.nativeEvent.locationX)}
      onResponderMove={(e) => select(e.nativeEvent.locationX)}
    >
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 300 300"
        preserveAspectRatio="none"
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="earnFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={palette.primary} stopOpacity={0.12} />
            <Stop offset="1" stopColor={palette.primary} stopOpacity={0.02} />
          </LinearGradient>
        </Defs>
        {[1, 5, 10, 15, 20, 25, 30].map((year) => (
          <Line
            key={year}
            x1={8 + (year / 30) * 284}
            x2={8 + (year / 30) * 284}
            y1={20}
            y2={298}
            stroke={palette.foreground}
            strokeOpacity={0.035}
          />
        ))}
        <Path d={`${path} L292,298 L8,298 Z`} fill="url(#earnFill)" />
        <Path d={path} fill="none" stroke={palette.primary} strokeWidth={1.5} />
        <Line
          x1={x}
          x2={x}
          y1={y(years)}
          y2={298}
          stroke={palette.primary}
          strokeOpacity={0.12}
          strokeWidth={7}
        />
        <Circle
          cx={x}
          cy={y(years)}
          r={5}
          fill={palette.primary}
          stroke={palette.background}
          strokeWidth={2}
        />
      </Svg>
    </View>
  );
}
