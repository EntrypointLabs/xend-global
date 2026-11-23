import React, { useEffect, useMemo, useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Divider } from "@/components/ui/atoms/Divider";
import { PillButton, Footnote } from "@/components/ui/kit";
import { FeatureScreen } from "@/components/ui/feature/FeatureScreen";
import { Illustration } from "@/components/ui/feature/Illustration";
import {
  Card,
  CardTitle,
  CopyRow,
} from "@/components/ui/organisms/naira/parts";
import { useAuth } from "@/contexts/AuthContext";
import { useNow } from "@/hooks/useNow";
import { usePalette } from "@/hooks/usePalette";
import { apiClient } from "@/utils/apiClient";
import { displayMoney, usdcAsDollars } from "@/utils/display-money";
import {
  fiatErrorCode,
  fiatErrorMessage,
  nairaAllowanceLeft,
  type FiatOrder,
} from "@/utils/fiat";
import { cn } from "@/utils/cn";

const PRESETS = [5_000, 10_000, 20_000, 50_000];
const MIN_NAIRA = 100;
const ROUTE_ID = "paj:ngn-usdc";
// The deposit account stays open at the partner for three days after the app
// stops showing it, so a late transfer still lands.
const LATE_WINDOW_MS = 72 * 60 * 60 * 1000;
const DISPLAY = { fontFamily: "Montserrat_900Black" } as const;

type Stage =
  | { kind: "amount" }
  | { kind: "pay"; orderId: string }
  | { kind: "watch"; orderId: string };

const naira = (whole: number) => displayMoney("NGN", String(whole * 100));

function groupAccountNumber(digits: string) {
  return digits.length === 10
    ? `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
    : digits;
}

/** The partner sends names like "Paj Inc.(Pay NGN 50,000.00)". */
function tidyAccountName(name: string) {
  return name.replace(/\s*\(/g, " (");
}

/** The deposit to pick back up when the screen opens again, if any. */
function resumable(orders: FiatOrder[]): Stage | null {
  const live = orders.find(
    (o) =>
      o.route.id === ROUTE_ID &&
      Date.parse(o.createdAt) + LATE_WINDOW_MS > Date.now() &&
      ["awaiting_payment", "processing", "needs_attention"].includes(o.status)
  );
  if (!live) return null;
  const showing =
    live.status === "awaiting_payment" &&
    Date.parse(live.instructions.expiresAt ?? "") > Date.now();
  return showing
    ? { kind: "pay", orderId: live.id }
    : live.status === "awaiting_payment"
      ? null
      : { kind: "watch", orderId: live.id };
}

/**
 * Add money by bank transfer. The partner opens a bank account for this one
 * deposit; the Consumer pays the exact amount from any bank app and the USDC
 * arrives in their Account.
 */
export default function AddNairaScreen() {
  const { isAuthenticated } = useAuth();
  const ordersQuery = useQuery({
    queryKey: ["fiat", "orders"],
    queryFn: () => apiClient.fiatOrders(),
    enabled: isAuthenticated === true,
  });
  const [stage, setStage] = useState<Stage | null>(null);

  useEffect(() => {
    // A cached list can still show a deposit as in flight after it finished,
    // which would reopen its tracker instead of a fresh form.
    if (stage || !ordersQuery.isFetchedAfterMount) return;
    setStage(resumable(ordersQuery.data?.orders ?? []) ?? { kind: "amount" });
  }, [stage, ordersQuery.isFetchedAfterMount, ordersQuery.data]);

  if (!stage) return <FeatureScreen leave="close">{null}</FeatureScreen>;
  if (stage.kind === "amount")
    return (
      <AmountStage onOrder={(id) => setStage({ kind: "pay", orderId: id })} />
    );
  return (
    <OrderStage
      orderId={stage.orderId}
      watching={stage.kind === "watch"}
      onSent={() => setStage({ kind: "watch", orderId: stage.orderId })}
      onRestart={() => setStage({ kind: "amount" })}
    />
  );
}

function AmountStage({ onOrder }: { onOrder: (orderId: string) => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const amountInput = useRef<TextInput>(null);
  const [typed, setTyped] = useState("");
  const [debounced, setDebounced] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = Number(typed || "0");
  const size = amountSize(typed.length);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(amount), 450);
    return () => clearTimeout(id);
  }, [amount]);

  const limits = useQuery({
    queryKey: ["fiat", "limits"],
    queryFn: () => apiClient.fiatLimits(),
  });
  const quote = useQuery({
    queryKey: ["fiat", "quote", ROUTE_ID, debounced],
    queryFn: () => apiClient.fiatQuote(ROUTE_ID, String(debounced * 100)),
    enabled: debounced >= MIN_NAIRA,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });

  const left = limits.data ? nairaAllowanceLeft(limits.data) : null;
  const verified = limits.data?.verified === true;
  const overLimit = !verified && left !== null && BigInt(amount * 100) > left;
  const estimate =
    quote.data && amount === debounced
      ? usdcAsDollars(quote.data.credit.amountMinor, "down")
      : null;

  const start = async () => {
    if (busy) return;
    if (overLimit) {
      router.push("/verify-identity");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // A fresh quote at the moment of asking: a preview may be minutes old.
      const fresh = await apiClient.fiatQuote(ROUTE_ID, String(amount * 100));
      if (fresh.verification?.verificationRequired) {
        router.push("/verify-identity");
        return;
      }
      const order = await apiClient.fiatCreateOrder(
        fresh.id,
        Crypto.randomUUID(),
        {}
      );
      void queryClient.invalidateQueries({ queryKey: ["fiat"] });
      onOrder(order.id);
    } catch (err) {
      if (fiatErrorCode(err) === "VERIFICATION_REQUIRED") {
        router.push("/verify-identity");
        return;
      }
      setError(
        fiatErrorMessage(err) ??
          "We couldn't set up your deposit. Nothing was charged. Try again."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <FeatureScreen
      leave="close"
      avoidKeyboard
      footer={
        <View className="gap-3">
          {error ? (
            <Footnote tone="error" className="text-center">
              {error}
            </Footnote>
          ) : null}
          <PillButton
            title={
              overLimit ? `Verify to add ${naira(amount)}` : "Get bank details"
            }
            disabled={amount < MIN_NAIRA}
            loading={busy}
            onPress={() => void start()}
          />
        </View>
      }
    >
      <View className="overflow-hidden rounded-[28px] bg-muted px-6 pb-5 pt-7">
        <Typography
          accessibilityRole="header"
          className="text-[34px] uppercase leading-[34px] tracking-[-1px] text-ink"
          style={DISPLAY}
        >
          Add naira
        </Typography>
        <Typography
          weight="500"
          className="mt-2 max-w-[220px] text-[14px] leading-[20px] text-foreground/55"
        >
          Pay from any Nigerian bank. It lands as dollars in your Account.
        </Typography>
        <View className="absolute -bottom-3 -right-3">
          <Illustration name="deposit" size={150} />
        </View>
        <View className="h-16" />
      </View>

      <Typography weight="500" className="mt-7 text-[14px] text-foreground/60">
        You send
      </Typography>
      <HapticPressable
        feedback="none"
        accessible={false}
        onPress={() => amountInput.current?.focus()}
        className="mt-1 flex-row items-center"
      >
        <Typography
          className={cn(size.text, typed ? "text-ink" : "text-foreground/20")}
          style={DISPLAY}
        >
          ₦
        </Typography>
        <View className="ml-1 h-[72px] flex-1 justify-center">
          {/* iOS draws a native placeholder this large with a clipped top, so
              the empty state is drawn here in the same type as the ₦. */}
          {typed ? null : (
            <Typography
              pointerEvents="none"
              className="absolute left-0 text-[52px] leading-[60px] text-foreground/20"
              style={DISPLAY}
            >
              0
            </Typography>
          )}
          <TextInput
            ref={amountInput}
            value={typed ? Number(typed).toLocaleString("en-NG") : ""}
            onChangeText={(text) => {
              setError(null);
              setTyped(text.replace(/\D/g, "").replace(/^0+/, "").slice(0, 9));
            }}
            keyboardType="number-pad"
            accessibilityLabel="Amount in naira"
            accessibilityHint="Or pick an amount below"
            className={cn("h-[72px] py-0 text-ink", size.input)}
            style={DISPLAY}
          />
        </View>
      </HapticPressable>

      <View className="mt-3 flex-row flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <HapticPressable
            key={preset}
            accessibilityRole="button"
            accessibilityLabel={`Add ${naira(preset)}`}
            accessibilityState={{ selected: amount === preset }}
            onPress={() => {
              setError(null);
              setTyped(String(preset));
            }}
            className={cn(
              "h-10 items-center justify-center rounded-full px-4",
              amount === preset ? "bg-primary" : "bg-foreground/[0.05]"
            )}
          >
            <Typography
              weight="600"
              className={cn(
                "text-[14px]",
                amount === preset ? "text-primary-foreground" : "text-ink"
              )}
            >
              {naira(preset).replace(".00", "")}
            </Typography>
          </HapticPressable>
        ))}
      </View>

      <View className="mt-7 gap-4 border-t border-foreground/[0.08] pt-5">
        <Row
          label="You get"
          value={
            amount < MIN_NAIRA
              ? "$0.00"
              : estimate
                ? `≈ ${estimate}`
                : "Checking the rate…"
          }
        />
        {verified ? (
          <Row label="Limit" value="Verified, no daily cap" />
        ) : (
          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel="Verify your identity to raise your limit"
            onPress={() => router.push("/verify-identity")}
            className="flex-row items-center justify-between"
          >
            <Typography weight="500" className="text-[15px] text-foreground/60">
              Left today
            </Typography>
            <View className="flex-row items-center gap-1.5">
              <Typography
                weight="600"
                className={cn(
                  "text-[15px] tabular-nums",
                  overLimit ? "text-destructive" : "text-ink"
                )}
              >
                {left === null
                  ? "Checking…"
                  : displayMoney("NGN", left.toString())}
              </Typography>
              <Typography weight="600" className="text-[15px] text-info">
                Raise
              </Typography>
            </View>
          </HapticPressable>
        )}
      </View>
      {overLimit ? (
        <Footnote className="mt-4">
          Without verification you can add up to ₦50,000 in any 24 hours.
          Verifying takes a minute with your BVN.
        </Footnote>
      ) : null}
    </FeatureScreen>
  );
}

/** Steps the display type down so a long amount stays on one line. */
function amountSize(digits: number) {
  if (digits > 7)
    return { text: "text-[34px] leading-[40px]", input: "text-[34px]" };
  if (digits > 5)
    return { text: "text-[42px] leading-[50px]", input: "text-[42px]" };
  return { text: "text-[52px] leading-[60px]", input: "text-[52px]" };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Typography weight="500" className="text-[15px] text-foreground/60">
        {label}
      </Typography>
      <Typography weight="600" className="text-[15px] tabular-nums text-ink">
        {value}
      </Typography>
    </View>
  );
}

function OrderStage({
  orderId,
  watching,
  onSent,
  onRestart,
}: {
  orderId: string;
  watching: boolean;
  onSent: () => void;
  onRestart: () => void;
}) {
  const router = useRouter();
  const now = useNow(1000);
  const query = useQuery({
    queryKey: ["fiat", "order", orderId],
    queryFn: () => apiClient.fiatOrder(orderId),
    refetchInterval: (q) =>
      ["completed", "failed", "returned"].includes(q.state.data?.status ?? "")
        ? false
        : 4000,
  });
  const order = query.data;
  const close = () =>
    router.canGoBack() ? router.back() : router.replace("/(tabs)");

  if (!order) {
    return <FeatureScreen leave="close">{null}</FeatureScreen>;
  }

  const expiresAt = Date.parse(order.instructions.expiresAt ?? "");
  const remaining = Math.max(0, expiresAt - now);
  const moving = order.status !== "awaiting_payment";

  if (!watching && !moving) {
    if (remaining <= 0) {
      return (
        <Outcome
          icon="time-outline"
          title="These details have expired"
          body="Start a new deposit to get fresh bank details. If you already sent the money, it still arrives: keep your bank receipt."
          primary={{ title: "Start a new deposit", onPress: onRestart }}
          secondary={{ title: "Close", onPress: close }}
        />
      );
    }
    return <PayStage order={order} remaining={remaining} onSent={onSent} />;
  }
  return <WatchStage order={order} onClose={close} onRestart={onRestart} />;
}

function PayStage({
  order,
  remaining,
  onSent,
}: {
  order: FiatOrder;
  remaining: number;
  onSent: () => void;
}) {
  const palette = usePalette();
  const i = order.instructions;
  const amount = i.transferAmount ?? order.quote.debit;
  const amountLabel = displayMoney("NGN", amount.amountMinor);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  const urgent = remaining < 5 * 60_000;
  return (
    <FeatureScreen
      leave="close"
      footer={<PillButton title="I've sent the money" onPress={onSent} />}
    >
      <View className="items-center">
        <View
          accessibilityLabel={`Details expire in ${minutes} minutes`}
          className={cn(
            "flex-row items-center gap-1.5 rounded-full px-3 py-1.5",
            urgent ? "bg-destructive/10" : "bg-foreground/[0.05]"
          )}
        >
          <Ionicons
            name="time-outline"
            size={14}
            color={
              urgent
                ? palette.dark
                  ? palette.destructive
                  : "#DC2626"
                : palette.ink
            }
          />
          <Typography
            weight="600"
            className={cn(
              "text-[13px] tabular-nums",
              urgent ? "text-destructive" : "text-ink"
            )}
          >
            {`Expires in ${minutes}:${String(seconds).padStart(2, "0")}`}
          </Typography>
        </View>
        <Typography
          accessibilityRole="header"
          className="mt-5 text-center text-[40px] leading-[46px] text-ink"
          style={DISPLAY}
        >
          {amountLabel}
        </Typography>
        <Typography
          weight="500"
          className="mt-1 text-center text-[14px] text-foreground/60"
        >
          {`You get ≈ ${usdcAsDollars(order.quote.credit.amountMinor, "down")}`}
        </Typography>
      </View>

      <View className="mt-7">
        <Card>
          <CardTitle
            title="Transfer to this account"
            subtitle="From any Nigerian bank app"
          />
          <Divider
            type="dashed"
            color={palette.fg(0.12)}
            dashGap={6}
            className="my-5"
          />
          <View className="gap-5">
            <CopyRow
              label="Amount"
              value={amountLabel}
              copyValue={String(BigInt(amount.amountMinor) / 100n)}
              copyLabel="amount"
            />
            <CopyRow
              label="Account number"
              value={groupAccountNumber(i.accountNumber ?? "")}
              copyValue={i.accountNumber}
              copyLabel="account number"
            />
            <CopyRow
              label="Bank"
              value={i.bankName ?? ""}
              copyLabel="bank name"
            />
            <CopyRow
              label="Account name"
              value={tidyAccountName(i.accountName ?? "")}
              copyValue={i.accountName ?? ""}
              copyLabel="account name"
            />
          </View>
        </Card>
      </View>

      <View className="mt-6 gap-4 px-1">
        <Rule
          icon="checkmark-circle-outline"
          text={`Send exactly ${amountLabel}, in one transfer.`}
        />
        <Rule
          icon="lock-closed-outline"
          text="This account is only for this deposit. Don't save it for next time."
        />
        <Rule
          icon="hourglass-outline"
          text="Paid after the timer runs out? It still arrives."
        />
      </View>
    </FeatureScreen>
  );
}

function Rule({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  const palette = usePalette();
  return (
    <View className="flex-row items-start gap-3">
      <Ionicons name={icon} size={18} color={palette.fg(0.55)} />
      <Typography
        weight="500"
        className="flex-1 text-[14px] leading-[20px] text-foreground/60"
      >
        {text}
      </Typography>
    </View>
  );
}

const STEPS = [
  { key: "sent", title: "Transfer sent", body: "From your bank app" },
  {
    key: "received",
    title: "Naira received",
    body: "Our partner confirms your transfer",
  },
  {
    key: "landed",
    title: "Dollars in your Account",
    body: "Ready to spend, send or save",
  },
] as const;

function WatchStage({
  order,
  onClose,
  onRestart,
}: {
  order: FiatOrder;
  onClose: () => void;
  onRestart: () => void;
}) {
  const reached = useMemo(() => {
    if (order.status === "completed") return 3;
    if (order.status === "processing") return 2;
    return 1;
  }, [order.status]);

  if (order.status === "failed" || order.status === "returned") {
    return (
      <Outcome
        icon="alert-circle-outline"
        title="This deposit stopped"
        body="Don't send money to those bank details again. If you already sent it, your money is safe: keep your bank receipt and contact support."
        primary={{ title: "Start a new deposit", onPress: onRestart }}
        secondary={{ title: "Close", onPress: onClose }}
      />
    );
  }

  const done = order.status === "completed";
  const checking = order.status === "needs_attention";
  const expiredUnpaid = order.status === "expired";

  return (
    <FeatureScreen
      leave="close"
      footer={<PillButton title={done ? "Done" : "Close"} onPress={onClose} />}
    >
      <View className="items-center pt-2">
        <Illustration name="deposit" size={150} />
        <Typography
          accessibilityRole="header"
          className="mt-4 text-center text-[28px] leading-[34px] tracking-[-0.6px] text-ink"
          style={DISPLAY}
        >
          {done
            ? usdcAsDollars(order.quote.credit.amountMinor, "down")
            : displayMoney(
                "NGN",
                (order.instructions.transferAmount ?? order.quote.debit)
                  .amountMinor
              )}
        </Typography>
        <Typography
          weight="500"
          className="mt-2 max-w-[300px] text-center text-[14px] leading-[20px] text-foreground/55"
        >
          {done
            ? "Arrived in your Account."
            : checking
              ? "Our partner is checking this deposit. If you've sent the money it's safe; don't send it again."
              : expiredUnpaid
                ? "We haven't seen your transfer yet. If you sent it, it still arrives."
                : "You can leave this screen. We'll update it the moment your money lands."}
        </Typography>
      </View>

      <View className="mt-8 rounded-[28px] border border-foreground/5 bg-card p-6">
        {STEPS.map((step, index) => {
          const complete = index < reached || done;
          const active = index === reached && !done;
          return (
            <View
              key={step.key}
              accessible
              accessibilityLabel={`${step.title}, ${complete ? "done" : active ? "in progress" : "not yet"}`}
              className="flex-row gap-4"
            >
              <View className="items-center">
                <View
                  className={cn(
                    "size-7 items-center justify-center rounded-full",
                    complete
                      ? "bg-success"
                      : active
                        ? "border-2 border-ink"
                        : "border-2 border-foreground/15"
                  )}
                >
                  {complete ? (
                    <Ionicons name="checkmark" size={16} color="white" />
                  ) : null}
                </View>
                {index < STEPS.length - 1 ? (
                  <View
                    className={cn(
                      "my-1 w-0.5 flex-1",
                      complete ? "bg-success" : "bg-foreground/10"
                    )}
                  />
                ) : null}
              </View>
              <View
                className={cn("flex-1", index < STEPS.length - 1 && "pb-6")}
              >
                <Typography
                  weight="600"
                  className={cn(
                    "text-[15px]",
                    complete || active ? "text-ink" : "text-foreground/35"
                  )}
                >
                  {step.title}
                </Typography>
                <Typography
                  weight="500"
                  className="mt-0.5 text-[13px] text-foreground/60"
                >
                  {step.body}
                </Typography>
              </View>
            </View>
          );
        })}
      </View>
    </FeatureScreen>
  );
}

function Outcome({
  icon,
  title,
  body,
  primary,
  secondary,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  primary: { title: string; onPress: () => void };
  secondary: { title: string; onPress: () => void };
}) {
  const palette = usePalette();
  return (
    <FeatureScreen
      leave="close"
      scroll={false}
      footer={
        <View className="gap-3">
          <PillButton title={primary.title} onPress={primary.onPress} />
          <PillButton
            title={secondary.title}
            tone="quiet"
            onPress={secondary.onPress}
          />
        </View>
      }
    >
      <View className="flex-1 items-center justify-center pb-16">
        <View className="size-16 items-center justify-center rounded-full bg-foreground/[0.05]">
          <Ionicons name={icon} size={30} color={palette.ink} />
        </View>
        <Typography
          accessibilityRole="header"
          weight="700"
          className="mt-6 text-center text-[26px] leading-[32px] tracking-[-0.5px] text-ink"
        >
          {title}
        </Typography>
        <Typography
          weight="500"
          className="mt-2 max-w-[310px] text-center text-[14px] leading-[20px] text-foreground/55"
        >
          {body}
        </Typography>
      </View>
    </FeatureScreen>
  );
}
