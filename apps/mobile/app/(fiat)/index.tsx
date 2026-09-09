import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { router, Stack, useLocalSearchParams, type Href } from "expo-router";
import { randomUUID } from "expo-crypto";
import { ThemedScreen } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import { ThemedButton } from "@/components/ui/molecules/ThemedButton";
import { useFiatOrder, useFiatOrders, useFiatRoutes } from "@/hooks/useFiat";
import { apiClient } from "@/utils/apiClient";
import {
  FiatQuote,
  FiatSimulationEvent,
  fiatAmountMinor,
  fiatFieldsValid,
  fiatMoneyLabel,
} from "@/utils/fiat";

export default function FiatScreen() {
  const params = useLocalSearchParams<{ direction?: string }>();
  const direction = params.direction === "send" ? "send" : "receive";
  const routes = useFiatRoutes();
  const orders = useFiatOrders();
  const [routeId, setRouteId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<FiatQuote | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [orderId, setOrderId] = useState<string | null>(null);
  const order = useFiatOrder(orderId);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const createKey = useRef<string | null>(null);
  const eventKeys = useRef<Record<string, string>>({});
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const available =
    routes.data?.routes.filter((r) => r.direction === direction) ?? [];
  const selected = available.find((r) => r.id === routeId) ?? available[0];
  const decimals = selected?.sourceCurrency === "USDC" ? 6 : 2;
  const minor = fiatAmountMinor(amount, decimals);
  const expired = Boolean(quote && Date.parse(quote.expiresAt) <= now);
  const current = order.data;
  const resetQuote = () => {
    setQuote(null);
    setFields({});
    createKey.current = null;
    setError(null);
  };
  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again."
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const canCreate = Boolean(
    quote &&
    quote.route.orderAvailable &&
    !expired &&
    fiatFieldsValid(quote, fields)
  );
  async function simulate(event: FiatSimulationEvent) {
    if (!current?.simulation || current.instructions.kind !== "simulation")
      return;
    await run(async () => {
      const action = `${current.id}:${event}`;
      eventKeys.current[action] ??= randomUUID();
      await apiClient.fiatSimulate(
        current.id,
        event,
        eventKeys.current[action]
      );
      await Promise.all([order.refetch(), orders.refetch()]);
    });
  }
  const simulationEvents: Record<string, FiatSimulationEvent[]> = {
    awaiting_payment: ["payment_received", "fail", "expire"],
    processing: ["complete", "fail"],
    expired: ["payment_received"],
    return_pending: ["return"],
    needs_attention: ["return"],
  };
  const statusLabel = (status: string) => status.replace(/_/g, " ");
  return (
    <ThemedScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-5 px-6 pb-12 pt-4"
          keyboardShouldPersistTaps="handled"
        >
          <Pressable accessibilityRole="button" onPress={() => router.back()}>
            <Typography className="py-2">← Back</Typography>
          </Pressable>
          <Typography weight="600" className="text-3xl">
            {direction === "receive" ? "Receive naira" : "Send to a bank"}
          </Typography>
          <Typography className="text-base text-black/50">
            {direction === "receive"
              ? "Convert a bank transfer into USDC in your Account."
              : "Convert USDC from your Account into naira."}
          </Typography>
          {__DEV__ && <ThemedButton variant="quiet" title="Test unified NGN + USDC balance" onPress={() => router.push("/(fiat)/unified" as Href)} />}
          <ThemedButton variant="quiet" title="Naira account (provider sandbox)" onPress={() => router.push("/(fiat)/accounts" as Href)} />
          <ThemedButton variant="quiet" title="Read account balances" onPress={() => router.push("/(fiat)/balances" as Href)} />
          {routes.isLoading && <ActivityIndicator />}
          {routes.isError && (
            <ThemedButton
              variant="quiet"
              title="Retry loading options"
              onPress={() => {
                void routes.refetch();
              }}
            />
          )}
          {!routes.isLoading && !routes.isError && available.length === 0 && (
            <Typography>No transfer options are available yet.</Typography>
          )}
          {!orderId &&
            available.map((route) => (
              <Pressable
                key={route.id}
                disabled={busy}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected?.id === route.id }}
                onPress={() => {
                  setRouteId(route.id);
                  resetQuote();
                }}
                className={`rounded-2xl border p-4 ${selected?.id === route.id ? "border-black bg-black/5" : "border-black/10"}`}
              >
                <Typography weight="600">
                  {__DEV__ ? `${route.provider} · ` : ""}
                  {route.sourceCurrency} → {route.destinationCurrency}
                </Typography>
                <Typography className="mt-1 text-black/50">
                  {route.environment === "simulation"
                    ? "Test mode · No real money"
                    : route.environment === "sandbox"
                      ? "Provider sandbox · Test only"
                      : "Rate preview"}
                </Typography>
                {!route.orderAvailable && (
                  <Typography className="mt-1">
                    Transfers not available yet
                  </Typography>
                )}
              </Pressable>
            ))}
          {!orderId && selected && (
            <>
              {selected.environment === "simulation" && (
                <Typography className="rounded-2xl bg-amber-50 p-4">
                  Test mode. This flow simulates money movement. Your Account
                  balance will not change. Use test details only.
                </Typography>
              )}
              <Typography weight="600">
                Amount in {selected.sourceCurrency}
              </Typography>
              <TextInput
                accessibilityLabel={`Amount in ${selected.sourceCurrency}`}
                value={amount}
                editable={!busy}
                onChangeText={(v) => {
                  setAmount(v);
                  resetQuote();
                }}
                keyboardType="decimal-pad"
                placeholder="0.00"
                className="rounded-2xl border border-black/10 p-4 text-3xl text-black"
              />
              {amount.length > 0 && !minor && (
                <Typography>
                  Enter a positive amount with at most {decimals} decimal
                  places.
                </Typography>
              )}
              <ThemedButton
                variant="secondary"
                title={busy ? "Please wait…" : "Get quote"}
                disabled={busy || !minor || !selected.quoteAvailable}
                onPress={() => {
                  void run(async () => {
                    setQuote(null);
                    const next = await apiClient.fiatQuote(selected.id, minor!);
                    setQuote(next);
                    setFields({});
                    createKey.current = randomUUID();
                  });
                }}
              />
              {quote && (
                <View className="gap-4 rounded-3xl bg-black/5 p-5">
                  <Typography weight="600" className="text-xl">
                    Review conversion
                  </Typography>
                  <Typography>You pay {fiatMoneyLabel(quote.debit)}</Typography>
                  <Typography>
                    You receive {fiatMoneyLabel(quote.credit)}
                  </Typography>
                  {quote.fees.map((fee, i) => (
                    <Typography key={i}>Fee: {fiatMoneyLabel(fee)}</Typography>
                  ))}
                  <Typography>
                    {expired
                      ? "Quote expired. Get a new quote."
                      : `Quote expires in ${Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - now) / 1000))} seconds`}
                  </Typography>
                  {quote.fields.map((f) => (
                    <View key={f.key} className="gap-2">
                      <Typography weight="600">
                        {f.label}
                        {f.required ? " *" : ""}
                      </Typography>
                      {f.type === "select" ? (
                        f.options.map((option) => (
                          <Pressable
                            key={option.value}
                            disabled={busy}
                            accessibilityRole="radio"
                            accessibilityState={{
                              checked: fields[f.key] === option.value,
                            }}
                            onPress={() =>
                              setFields((v) => ({
                                ...v,
                                [f.key]: option.value,
                              }))
                            }
                            className={`rounded-xl border p-3 ${fields[f.key] === option.value ? "border-black" : "border-black/10"}`}
                          >
                            <Typography>{option.label}</Typography>
                          </Pressable>
                        ))
                      ) : (
                        <TextInput
                          accessibilityLabel={f.label}
                          editable={!busy}
                          value={fields[f.key] ?? ""}
                          onChangeText={(value) =>
                            setFields((v) => ({ ...v, [f.key]: value }))
                          }
                          autoCapitalize="none"
                          className="rounded-xl border border-black/10 bg-white p-3 text-black"
                        />
                      )}
                    </View>
                  ))}
                  <ThemedButton
                    variant="secondary"
                    title={
                      !quote.route.orderAvailable
                        ? "Transfers not available yet"
                        : quote.paymentStep === "simulation"
                          ? "Start test transfer"
                          : "Continue"
                    }
                    disabled={busy || !canCreate}
                    onPress={() => {
                      void run(async () => {
                        if (
                          !canCreate ||
                          Date.parse(quote.expiresAt) <= Date.now()
                        )
                          throw new Error(
                            "Get a fresh quote before continuing."
                          );
                        createKey.current ??= randomUUID();
                        const created = await apiClient.fiatCreateOrder(
                          quote.id,
                          createKey.current,
                          fields
                        );
                        setOrderId(created.id);
                        await orders.refetch();
                      });
                    }}
                  />
                </View>
              )}
            </>
          )}
          {orderId && (
            <View className="gap-4 rounded-3xl bg-black/5 p-5">
              <Typography weight="600" className="text-xl">
                Transfer status
              </Typography>
              {order.isLoading && <ActivityIndicator />}
              {current && (
                <>
                  {current.simulation && (
                    <Typography weight="600">
                      Test mode · No real money
                    </Typography>
                  )}
                  <Typography className="capitalize">
                    {statusLabel(current.status)}
                  </Typography>
                  <Typography>
                    {fiatMoneyLabel(current.quote.debit)} →{" "}
                    {fiatMoneyLabel(current.quote.credit)}
                  </Typography>
                  <Typography>{current.instructions.message}</Typography>
                  {current.instructions.accountNumber && (
                    <Typography selectable>
                      {current.instructions.bankName} ·{" "}
                      {current.instructions.accountNumber}
                    </Typography>
                  )}
                  {current.simulation &&
                    current.instructions.kind === "simulation" && (
                      <>
                        <Typography>Test controls</Typography>
                        {(simulationEvents[current.status] ?? []).map(
                          (event) => (
                            <ThemedButton
                              key={event}
                              variant="quiet"
                              title={`Simulate ${statusLabel(event)}`}
                              disabled={busy}
                              onPress={() => {
                                void simulate(event);
                              }}
                            />
                          )
                        )}
                      </>
                    )}
                </>
              )}
              <ThemedButton
                variant="quiet"
                title="Refresh status"
                disabled={busy}
                onPress={() => {
                  void order.refetch();
                }}
              />
              <ThemedButton
                variant="quiet"
                title="Back to transfer options"
                disabled={busy}
                onPress={() => {
                  setOrderId(null);
                  resetQuote();
                }}
              />
            </View>
          )}
          {(error || order.isError) && (
            <Typography accessibilityRole="alert" className="text-red-700">
              {error ?? "Could not refresh this transfer. Try again."}
            </Typography>
          )}
          <View className="gap-2 rounded-2xl border border-black/10 p-4">
            <Typography weight="600">Account options</Typography>
            <Typography className="text-black/50">
              Permanent naira accounts, automatic conversion settings and
              naira-to-naira transfers are not available yet.
            </Typography>
            {direction === "receive" && (
              <Typography className="text-black/50">
                Verification and temporary bank details depend on the available
                provider. No no-KYC account is currently offered.
              </Typography>
            )}
          </View>
          <Typography weight="600" className="text-xl">
            Recent transfers
          </Typography>
          {orders.isError && (
            <ThemedButton
              variant="quiet"
              title="Retry recent transfers"
              onPress={() => {
                void orders.refetch();
              }}
            />
          )}
          {orders.data?.orders
            .filter((o) => o.route.direction === direction)
            .map((o) => (
              <Pressable
                key={o.id}
                accessibilityRole="button"
                disabled={busy}
                className="rounded-2xl bg-black/5 p-4"
                onPress={() => {
                  setOrderId(o.id);
                  setError(null);
                }}
              >
                <Typography>
                  {fiatMoneyLabel(o.quote.debit)} · {statusLabel(o.status)}
                </Typography>
                <Typography className="text-black/50">
                  {o.simulation ? "Test transfer · " : ""}
                  {new Date(o.createdAt).toLocaleString()}
                </Typography>
              </Pressable>
            ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedScreen>
  );
}
