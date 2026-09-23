import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { router, Stack, useLocalSearchParams, type Href } from "expo-router";
import { randomUUID } from "expo-crypto";
import { ScreenLayout } from "@/components/ui/layout";
import {
  FiatCard,
  FiatHeader,
  FiatLink,
  FiatNotice,
  FiatTextInput,
} from "@/components/fiat/FiatUI";
import { Typography } from "@/components/ui/atoms/Typography";
import { ThemedButton } from "@/components/ui/molecules/ThemedButton";
import { useFiatOrder, useFiatOrders, useFiatRoutes } from "@/hooks/useFiat";
import { apiClient } from "@/utils/apiClient";
import {
  FiatQuote,
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
  const [now, setNow] = useState(() => Date.now());
  const createKey = useRef<string | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const available =
    routes.data?.routes.filter(
      (r) => r.direction === direction && r.environment !== "simulation"
    ) ?? [];
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
  const statusLabel = (status: string) => status.replace(/_/g, " ");
  return (
    <ScreenLayout>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-5 pb-12"
          keyboardShouldPersistTaps="handled"
        >
          <FiatHeader
            title={direction === "receive" ? "Receive naira" : "Send to a bank"}
            subtitle={
              direction === "receive"
                ? "Convert a bank transfer into USDC in your Account."
                : "Convert USDC from your Account into naira."
            }
          />
          <View className="gap-3">
            <FiatLink
              icon="business-outline"
              title="Naira account"
              subtitle="View your provider account details"
              onPress={() => router.push("/(fiat)/accounts" as Href)}
            />
            <FiatLink
              icon="wallet-outline"
              title="Balances"
              subtitle="View bank and onchain balances"
              onPress={() => router.push("/(fiat)/balances" as Href)}
            />
          </View>
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
                  {route.environment === "sandbox"
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
              <Typography weight="600">
                Amount in {selected.sourceCurrency}
              </Typography>
              <FiatTextInput
                accessibilityLabel={`Amount in ${selected.sourceCurrency}`}
                value={amount}
                editable={!busy}
                onChangeText={(v) => {
                  setAmount(v);
                  resetQuote();
                }}
                keyboardType="decimal-pad"
                placeholder="0.00"
                className="py-5 text-3xl"
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
                <FiatCard className="gap-4 bg-black/[0.025]">
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
                        <FiatTextInput
                          accessibilityLabel={f.label}
                          editable={!busy}
                          value={fields[f.key] ?? ""}
                          onChangeText={(value) =>
                            setFields((v) => ({ ...v, [f.key]: value }))
                          }
                          autoCapitalize="none"
                        />
                      )}
                    </View>
                  ))}
                  <ThemedButton
                    variant="secondary"
                    title={
                      !quote.route.orderAvailable
                        ? "Transfers not available yet"
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
                </FiatCard>
              )}
            </>
          )}
          {orderId && (
            <FiatCard className="gap-4 bg-black/[0.025]">
              <Typography weight="600" className="text-xl">
                Transfer status
              </Typography>
              {order.isLoading && <ActivityIndicator />}
              {current && (
                <>
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
            </FiatCard>
          )}
          {(error || order.isError) && (
            <Typography accessibilityRole="alert" className="text-red-700">
              {error ?? "Could not refresh this transfer. Try again."}
            </Typography>
          )}
          <FiatNotice>
            {selected?.environment === "sandbox"
              ? "Quotes use provider sandbox rates. A real transfer is only offered when the provider supports verified execution."
              : "Quotes are estimates until the provider confirms the exact amount and execution details."}
          </FiatNotice>
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
            .filter(
              (o) =>
                o.route.direction === direction &&
                o.route.environment !== "simulation"
            )
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
                  {new Date(o.createdAt).toLocaleString()}
                </Typography>
              </Pressable>
            ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenLayout>
  );
}
