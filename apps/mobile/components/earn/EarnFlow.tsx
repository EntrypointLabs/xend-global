import { useExecuteEarn } from "@/hooks/useExecuteEarn";
import React, { useState } from "react";
import {
  ActivityIndicator,
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
} from "react-native-svg";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { FrostBlurView } from "@/components/ui/atoms/FrostBlurView";
import { Typography } from "@/components/ui/atoms/Typography";
import { usePalette } from "@/hooks/usePalette";
import { showToast } from "@/utils/toast";
import { useBalances } from "@/hooks/useBalances";
import { getUsdcMint } from "@/utils/cluster";
import { formatTokenAmount } from "@/utils/tokens";
import type { EarnProduct } from "@/hooks/useEarn";
import { formatEarnMoney, projectedValue } from "@/utils/earnProjection";
import { apyLabel } from "@/components/earn/EarnProductRows";
import { EarnBarChart } from "@/components/earn/EarnBarChart";
import {
  AssetChip,
  AssetPickerSheet,
  TokenStack,
  type PickableAsset,
} from "@/components/earn/EarnAssets";

export type EarnFlowState =
  | { step: "choose" | "choose-withdraw" }
  | { step: "info"; productId: string }
  | {
      step: "deposit" | "withdraw";
      productId: string;
      /** Where back returns to. Without it the screen was opened directly and back closes it. */
      from?: "choose" | "choose-withdraw" | "info";
      /** The token to start on, when the screen was opened from one. */
      mint?: string;
    };
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
  // The modal animates out after the flow is cleared. Rendering the last
  // screen through that animation keeps the closing frames from falling back
  // to the product picker.
  const [shown, setShown] = useState<{
    flow: EarnFlowState | null;
    open: boolean;
    animation: "fade" | "slide";
  }>({ flow: null, open: false, animation: "fade" });
  if (props.flow && !shown.open) {
    const full =
      props.flow.step === "deposit" || props.flow.step === "withdraw";
    // A full screen opened straight from a page slides up over it; a sheet
    // fades in over the blur. Fading a full screen shows both at once.
    setShown({
      flow: props.flow,
      open: true,
      animation: full ? "slide" : "fade",
    });
  } else if (props.flow && props.flow !== shown.flow) {
    setShown({ ...shown, flow: props.flow });
  } else if (!props.flow && shown.open) {
    setShown({ ...shown, open: false });
  }
  const flow = shown.flow;
  const product =
    flow && "productId" in flow
      ? props.products.find((p) => p.id === flow.productId)
      : undefined;
  const fullScreen = flow?.step === "deposit" || flow?.step === "withdraw";
  const withdrawable = props.products.filter(
    (p) =>
      (props.positionBalances[p.id] ?? 0) > 0 ||
      p.assets.some((a) => a.withdrawable > 0)
  );
  const pickable =
    flow?.step === "choose-withdraw" ? withdrawable : props.products;
  return (
    <Modal
      visible={!!props.flow}
      transparent
      animationType={shown.animation}
      onRequestClose={() => props.onChange(null)}
    >
      {fullScreen && product ? (
        <DepositScreen
          key={`${flow.step}:${product.id}`}
          {...props}
          product={product}
          withdraw={flow.step === "withdraw"}
          from={"from" in flow ? flow.from : undefined}
          mint={"mint" in flow ? flow.mint : undefined}
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
                    props.onChange({
                      step: "deposit",
                      productId: product.id,
                      from: "info",
                    })
                  }
                  onClose={() => props.onChange(null)}
                />
              ) : (
                <>
                  <CloseButton onPress={() => props.onChange(null)} />
                  <View className="items-center pb-7 pt-1">
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
                  {pickable.map((p) => (
                    <HapticPressable
                      key={p.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${p.provider}`}
                      onPress={() =>
                        props.onChange(
                          flow?.step === "choose-withdraw"
                            ? {
                                step: "withdraw",
                                productId: p.id,
                                from: "choose-withdraw",
                              }
                            : {
                                step: "deposit",
                                productId: p.id,
                                from: "choose",
                              }
                        )
                      }
                      className="flex-row items-center gap-3 py-4"
                    >
                      <ProviderIcon product={p} />
                      <View className="flex-1">
                        <Typography variant="title2" weight="600">
                          {p.provider}
                        </Typography>
                        <View className="mt-1 flex-row items-center gap-1">
                          <Typography
                            variant="body"
                            className="text-foreground/40"
                          >
                            {p.name} ·
                          </Typography>
                          <Typography variant="body" className="text-success">
                            {apyLabel(p)}
                          </Typography>
                        </View>
                      </View>
                      <TokenStack
                        assets={
                          flow?.step === "choose-withdraw"
                            ? p.assets.filter((a) => (a.position ?? 0) > 0)
                            : p.assets
                        }
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
        <View className="flex-row items-center gap-2">
          {product.icon && (
            <Image source={product.icon} className="h-6 w-6 rounded-md" />
          )}
          <Typography variant="title1" weight="600">
            {product.provider}
          </Typography>
        </View>
        <Typography variant="body" className="text-foreground/40">
          {product.name}
        </Typography>
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
                : `${product.apyDisplay} APY`}
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
          What you could earn
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
        <EarnBarChart values={Array.from({ length: 12 }, (_, i) => i + 1)} />
      </View>
      <Typography
        variant="body"
        className="mb-3 mt-4 text-center text-foreground/30"
      >
        Deposit your {product.assets.length > 1 ? "assets" : "dollars"} with{" "}
        {product.provider}
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
  from,
  mint,
}: Props & {
  product: EarnProduct;
  withdraw: boolean;
  from?: "choose" | "choose-withdraw" | "info";
  mint?: string;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const execution = useExecuteEarn();
  const balances = useBalances();
  const usdcMint = getUsdcMint();
  // Every token the product lends, including ones with nothing to move: the
  // picker shows those at zero and does not let them be chosen.
  const choices: PickableAsset[] = product.assets.map((asset) => {
    const held = balances.tokens.find((t) => t.mint === asset.mint);
    const heldAmount = held ? Number(held.amountRaw) / 10 ** held.decimals : 0;
    const amount = withdraw
      ? asset.mint === usdcMint
        ? (positionBalances[product.id] ?? 0)
        : asset.withdrawable
      : asset.mint === usdcMint
        ? available
        : (asset.depositable ?? heldAmount);
    const price =
      asset.mint === usdcMint
        ? 1
        : held?.usdValue != null && heldAmount > 0
          ? held.usdValue / heldAmount
          : asset.positionUsd != null && (asset.position ?? 0) > 0
            ? asset.positionUsd / (asset.position ?? 1)
            : null;
    return {
      mint: asset.mint,
      symbol: asset.symbol,
      name: asset.name,
      iconUrl: asset.iconUrl,
      decimals: asset.decimals,
      amount,
      usd: amount === 0 ? 0 : price === null ? null : amount * price,
    };
  });
  const [assetMint, setAssetMint] = useState(
    mint ??
      choices.find((c) => c.amount > 0)?.mint ??
      choices[0]?.mint ??
      usdcMint
  );
  const [picking, setPicking] = useState(false);
  const asset = choices.find((c) => c.mint === assetMint) ??
    choices[0] ?? {
      mint: usdcMint,
      symbol: "USDC",
      name: "USD Coin",
      iconUrl: null,
      decimals: 6,
      amount: withdraw ? (positionBalances[product.id] ?? 0) : available,
      usd: null,
    };
  const lent = product.assets.find((a) => a.mint === asset.mint);
  const apy = lent?.apy ?? product.apy;
  const apyDisplay = lent?.apyDisplay ?? product.apyDisplay;
  const dollars = asset.mint === usdcMint;
  const price = dollars
    ? 1
    : asset.usd !== null && asset.amount > 0
      ? asset.usd / asset.amount
      : null;
  const limit = asset.amount;
  const step = dollars ? 0.01 : 10 ** -Math.min(asset.decimals, 4);
  const [message, setMessage] = useState<string | null>(null);
  const move = async () => {
    setMessage(null);
    const wasPending = execution.hasPending;
    // Once the move is submitted the screen has done its job: it closes and
    // the toast carries the rest, the way a send does.
    let submitted = false;
    const result = await execution.execute(
      product.id,
      withdraw ? "redeem" : "deposit",
      amount,
      withdraw && amount === limit,
      dollars ? undefined : asset.mint,
      () => {
        submitted = true;
        toastEarnMoving(withdraw);
        onChange(null);
      }
    );
    if (submitted) {
      if (result.status === "confirmed") toastEarnDone(withdraw, wasPending);
      else if (result.status === "failed") toastEarnFailed(result.message);
      // Still pending: the toast runs out and the screen picks the saved
      // approval up next time, as Activity does for a send.
      return;
    }
    if (result.status === "confirmed") {
      toastEarnDone(withdraw, wasPending);
      onChange(null);
    } else if (result.status === "pending")
      setMessage(
        "Your approval is saved. Check its status before trying another amount."
      );
    else if (result.status === "failed") setMessage(result.message);
  };
  // Withdrawing starts at everything; depositing starts at nothing, so no
  // amount moves without the Consumer choosing it.
  const [chosen, setChosen] = useState(withdraw ? limit : 0);
  const [years, setYears] = useState(10);
  const amount = Math.min(chosen, limit);
  const amountUsd = price === null ? null : amount * price;
  const limitUsd = price === null ? null : limit * price;
  const showAmount = (units: number) =>
    dollars
      ? formatEarnMoney(units)
      : `${formatTokenAmount(units, asset.decimals)} ${asset.symbol}`;
  const pick = (next: string) => {
    const choice = choices.find((c) => c.mint === next);
    setAssetMint(next);
    setChosen(withdraw ? (choice?.amount ?? 0) : 0);
    setPicking(false);
  };
  // The server opens each token separately, so another token can be looked at
  // before it can be moved.
  const open = dollars
    ? !!(withdraw ? product.withdrawAvailable : product.available)
    : !!(withdraw ? lent?.withdrawAvailable : lent?.available);
  const supported = dollars || open;
  const canMove =
    execution.ready &&
    (execution.hasPending ||
      (execution.configured &&
        open &&
        (withdraw || depositsEnabled) &&
        balanceReady &&
        !product.simulated &&
        amount > 0));
  const estimated =
    apy === null || amountUsd === null
      ? null
      : projectedValue(amountUsd, apy, years);
  const chip =
    choices.length > 1 ? (
      <AssetChip asset={asset} onPress={() => setPicking(true)} />
    ) : null;
  return (
    <View
      accessibilityViewIsModal
      className="flex-1 bg-background px-6"
      // MEASURED-LAYOUT: safe-area spacing keeps the fixed CTA above the home indicator.
      style={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }}
    >
      <View className="mb-6 flex-row items-center justify-between">
        {from ? (
          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            disabled={execution.isExecuting}
            onPress={() =>
              onChange(
                from === "info"
                  ? { step: "info", productId: product.id }
                  : { step: from }
              )
            }
            className="h-10 w-10 items-center justify-center rounded-full bg-foreground/5"
          >
            <Ionicons
              name="chevron-back"
              size={20}
              color={palette.foreground}
            />
          </HapticPressable>
        ) : (
          <View className="h-10 w-10" />
        )}
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
            ? "You withdraw"
            : apy === null
              ? "Rate unavailable"
              : `Start earning ${apyDisplay}`}
        </Typography>
        <Typography
          variant="h2"
          weight="700"
          className="mt-2"
          accessibilityLiveRegion="polite"
        >
          {withdraw
            ? showAmount(amount)
            : estimated === null
              ? "—"
              : formatEarnMoney(estimated)}
        </Typography>
        <Typography variant="caption" className="mt-1 text-foreground/40">
          {withdraw
            ? !dollars && amountUsd !== null
              ? `About ${formatEarnMoney(amountUsd)}, from ${product.provider} to your account`
              : `From ${product.provider} to your ${dollars ? "cash" : "account"}`
            : `Estimated value in ${years} ${years === 1 ? "year" : "years"}`}
        </Typography>
      </View>
      <View className="mb-8 mt-9 flex-1">
        <ProjectionChart
          apy={apy}
          amount={withdraw ? limit - amount : amount}
          full={withdraw ? limit : undefined}
          years={years}
          onYears={setYears}
        />
        <View className="mt-3 flex-row justify-between">
          <Typography variant="caption" className="text-foreground/35">
            Today
          </Typography>
          <Typography variant="caption" className="text-foreground/35">
            30Y
          </Typography>
        </View>
      </View>
      {withdraw ? (
        <View className="items-center gap-3 pb-5">
          {chip}
          <Typography variant="body" className="text-center text-foreground/45">
            {estimated === null || amountUsd === null ? (
              "Interest you give up is unavailable"
            ) : (
              <>
                You give up about{" "}
                <Typography variant="body" weight="600">
                  {formatEarnMoney(estimated - amountUsd)}
                </Typography>{" "}
                in interest over {years} {years === 1 ? "year" : "years"}
              </>
            )}
          </Typography>
        </View>
      ) : (
        <View className="items-center pb-3">
          <Typography variant="caption" className="text-foreground/40">
            Initial deposit
          </Typography>
          <View className="mt-1 flex-row items-center gap-3">
            <Typography variant="title1" weight="600">
              {dollars
                ? formatEarnMoney(amount)
                : formatTokenAmount(amount, asset.decimals)}
            </Typography>
            {chip}
          </View>
          {!dollars && amountUsd !== null && (
            <Typography variant="caption" className="mt-1 text-foreground/40">
              About {formatEarnMoney(amountUsd)}
            </Typography>
          )}
        </View>
      )}
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={withdraw ? "Withdrawal amount" : "Initial deposit"}
        accessibilityValue={{
          min: 0,
          max: limit,
          now: amount,
          text: showAmount(amount),
        }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={({ nativeEvent }) =>
          setChosen(
            Math.min(
              limit,
              Math.max(
                0,
                amount +
                  (nativeEvent.actionName === "increment" ? 1 : -1) *
                    (dollars ? 1 : limit / 20)
              )
            )
          )
        }
      >
        <Slider
          value={amount}
          minimumValue={0}
          maximumValue={Math.max(limit, step)}
          step={step}
          disabled={
            execution.isExecuting ||
            execution.hasPending ||
            !balanceReady ||
            limit <= 0
          }
          onValueChange={(value) =>
            setChosen(value >= limit - step ? limit : value)
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
          ? `${showAmount(limit)}${!dollars && limitUsd !== null ? ` (${formatEarnMoney(limitUsd)})` : ""} ${withdraw ? "in this position" : "available"}`
          : "Balance unavailable"}
        {withdraw ? "" : " · Returns vary"}
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
        className="h-14 items-center justify-center rounded-full bg-primary"
      >
        {execution.isExecuting ? (
          <ActivityIndicator size="small" className="text-primary-foreground" />
        ) : (
          <Typography
            variant="body"
            weight="600"
            className="text-primary-foreground"
          >
            {execution.hasPending
              ? "Check previous approval"
              : withdraw
                ? "Withdraw"
                : "Add Money"}
          </Typography>
        )}
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
              : !supported
                ? `${asset.symbol} ${withdraw ? "withdrawals" : "deposits"} are coming soon`
                : !open || !execution.configured
                  ? "Not available yet"
                  : withdraw
                    ? "Arrives in your cash balance. Network fees are covered."
                    : "Rates vary. Network fees are covered.")}
      </Typography>
      {picking && (
        <AssetPickerSheet
          title={withdraw ? "Withdraw which token?" : "Deposit which token?"}
          assets={byValueHeld(choices)}
          selected={asset.mint}
          onPick={pick}
          onClose={() => setPicking(false)}
        />
      )}
    </View>
  );
}

/**
 * Growth of `amount` over 30 years. With `full`, the chart is a withdrawal:
 * the solid line is what stays in and the faint one is the whole position
 * left untouched, both on one scale from zero, so the gap is what leaving
 * costs.
 */
function ProjectionChart({
  apy,
  amount,
  full,
  years,
  onYears,
}: {
  apy: number | null;
  amount: number;
  full?: number;
  years: number;
  onYears: (years: number) => void;
}) {
  const palette = usePalette();
  const [width, setWidth] = useState(300);
  const rate = apy ?? 0;
  const principal =
    full === undefined ? Math.max(amount, 1) : Math.max(amount, 0);
  const top = projectedValue(
    full === undefined ? principal : Math.max(full, 0.01),
    rate,
    30
  );
  const floor = full === undefined ? principal * 0.6 : 0;
  const yOf = (value: number) =>
    280 - (260 * (value - floor)) / Math.max(top - floor, 1e-9);
  const pathFor = (start: number) =>
    `M${Array.from(
      { length: 121 },
      (_, i) =>
        `${8 + (i / 120) * 284},${yOf(projectedValue(start, rate, i / 4))}`
    ).join(" L")}`;
  const y = (year: number) => yOf(projectedValue(principal, rate, year));
  const path = pathFor(principal);
  const ghost = full === undefined ? null : pathFor(Math.max(full, 0));
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
        {ghost && (
          <Path
            d={ghost}
            fill="none"
            stroke={palette.foreground}
            strokeOpacity={0.18}
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />
        )}
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

/**
 * What the Consumer holds most of first, by dollar value. Tokens worth the
 * same, which is every one they hold none of, keep the product's own order.
 */
function byValueHeld(choices: PickableAsset[]): PickableAsset[] {
  const worth = (c: PickableAsset) =>
    c.usd ?? (c.amount > 0 ? Number.MIN_VALUE : 0);
  return [...choices].sort((a, b) => worth(b) - worth(a));
}

const EARN_TOAST_ID = "earn";
/** Long enough to cover the confirmation the move waits on. */
const EARN_MOVING_TOAST_MS = 20_000;
const EARN_FAILED_TOAST_MS = 5_000;

function toastEarnMoving(withdraw: boolean) {
  showToast(
    withdraw ? "Withdrawing" : "Depositing",
    <ActivityIndicator size="small" className="text-foreground" />,
    { id: EARN_TOAST_ID, durationMs: EARN_MOVING_TOAST_MS }
  );
}

function toastEarnDone(withdraw: boolean, finishedEarlier: boolean) {
  showToast(
    finishedEarlier ? "Confirmed" : withdraw ? "Withdrawn" : "Deposited",
    <Ionicons name="checkmark-circle" size={16} className="text-success" />,
    { id: EARN_TOAST_ID, tone: "success" }
  );
}

/** The toast says it failed; the reason is logged for tracing. */
function toastEarnFailed(reason: string) {
  console.warn(`[earn] ${reason}`);
  showToast(
    "Failed",
    <Ionicons name="close-circle" size={16} className="text-destructive" />,
    { id: EARN_TOAST_ID, durationMs: EARN_FAILED_TOAST_MS, tone: "failed" }
  );
}
