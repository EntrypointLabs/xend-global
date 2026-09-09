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
import { router, Stack, type Href } from "expo-router";
import { randomUUID } from "expo-crypto";
import { ThemedScreen } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import { ThemedButton } from "@/components/ui/molecules/ThemedButton";
import { useUnifiedFiat } from "@/hooks/useUnifiedFiat";
import { apiClient } from "@/utils/apiClient";
import { fiatAmountMinor } from "@/utils/fiat";
import {
  UnifiedCurrency,
  UnifiedQuote,
  unifiedMoney,
} from "@/utils/unified-fiat";

export default function UnifiedFiatScreen() {
  const [display, setDisplay] = useState<"USD" | "NGN">("USD");
  const snapshot = useUnifiedFiat(display);
  const [receiveCurrency, setReceiveCurrency] =
    useState<UnifiedCurrency>("NGN");
  const [receiveAmount, setReceiveAmount] = useState("");
  const [destinationCurrency, setDestinationCurrency] =
    useState<UnifiedCurrency>("USDC");
  const [destination, setDestination] = useState("test-wallet");
  const [amount, setAmount] = useState("");
  const [sendAll, setSendAll] = useState(false);
  const [manualSteps, setManualSteps] = useState(false);
  const [quote, setQuote] = useState<UnifiedQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);
  const keys = useRef<Record<string, string>>({});
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const key = (name: string) => (keys.current[name] ??= randomUUID());
  const rawReceiveMinor = fiatAmountMinor(
    receiveAmount,
    receiveCurrency === "USDC" ? 6 : 2
  );
  const rawRecipientMinor = fiatAmountMinor(
    amount,
    destinationCurrency === "USDC" ? 6 : 2
  );
  const receiveMinor =
    rawReceiveMinor && rawReceiveMinor.length <= 18 ? rawReceiveMinor : null;
  const recipientMinor =
    rawRecipientMinor && rawRecipientMinor.length <= 18
      ? rawRecipientMinor
      : null;
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
          : "Unable to complete this test. Retry when ready."
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const inputClass =
    "rounded-xl border border-black/20 px-4 py-3 text-base text-black";
  function choices<T extends string>(
    values: T[],
    selected: T,
    onChange: (value: T) => void
  ) {
    return (
      <View className="flex-row gap-3">
        {values.map((value) => (
          <Pressable
            key={value}
            disabled={busy}
            accessibilityRole="radio"
            accessibilityState={{ checked: value === selected }}
            onPress={() => onChange(value)}
            className={`rounded-xl border px-4 py-3 ${selected === value ? "border-black bg-black/5" : "border-black/20"}`}
          >
            <Typography>{value}</Typography>
          </Pressable>
        ))}
      </View>
    );
  }
  return (
    <ThemedScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerClassName="gap-5 px-6 pt-4 pb-12"
          keyboardShouldPersistTaps="handled"
        >
          <Pressable accessibilityRole="button" onPress={() => router.back()}>
            <Typography className="py-2">← Back</Typography>
          </Pressable>
          <Typography weight="600" className="text-3xl">
            Unified balance test
          </Typography>
          <Typography className="rounded-2xl bg-amber-50 p-4">
            Simulation only. These test holdings are separate from your real
            Cash. No bank transfer, conversion or crypto send happens here.
          </Typography>
          <ThemedButton
            variant="quiet"
            title="Provider sandbox: Naira account"
            onPress={() => router.push("/(fiat)/accounts" as Href)}
          />
          <ThemedButton variant="quiet" title="Read provider and chain balances" onPress={() => router.push("/(fiat)/balances" as Href)} />
          {snapshot.isLoading && <ActivityIndicator />}
          {snapshot.isError && (
            <>
              <Typography>
                Test balances could not load. This feature may be disabled on
                this server.
              </Typography>
              <ThemedButton
                title="Retry"
                variant="quiet"
                onPress={() => {
                  void snapshot.refetch();
                }}
              />
            </>
          )}
          {snapshot.data && (
            <>
              {choices(["USD", "NGN"], display, setDisplay)}
              <Typography weight="600" className="text-3xl">
                {unifiedMoney(snapshot.data.total.totalMinor, display)}
              </Typography>
              <Typography>
                Estimated total · Available{" "}
                {unifiedMoney(snapshot.data.total.availableMinor, display)}. The
                final Send quote includes fees.
              </Typography>
              {(["NGN", "USDC"] as const).map((currency) => (
                <View
                  key={currency}
                  className="rounded-2xl border border-black/10 p-4"
                >
                  <Typography weight="600">
                    {unifiedMoney(
                      (
                        BigInt(snapshot.data!.holdings[currency].settledMinor) -
                        BigInt(snapshot.data!.holdings[currency].reservedMinor)
                      ).toString(),
                      currency
                    )}
                  </Typography>
                  <Typography>
                    Available above · Reserved for pending Sends:{" "}
                    {unifiedMoney(
                      snapshot.data!.holdings[currency].reservedMinor,
                      currency
                    )}
                  </Typography>
                </View>
              ))}
              <Typography weight="600" className="text-xl">
                Simulate Receive
              </Typography>
              {choices(["NGN", "USDC"], receiveCurrency, setReceiveCurrency)}
              <TextInput
                accessibilityLabel="Test receive amount"
                placeholder="Amount to receive"
                keyboardType="decimal-pad"
                editable={!busy}
                value={receiveAmount}
                onChangeText={setReceiveAmount}
                className={inputClass}
              />
              <ThemedButton
                title="Receive test money"
                disabled={busy || !receiveMinor}
                onPress={() => {
                  void run(async () => {
                    if (!receiveMinor) return;
                    const action = `receive:${receiveCurrency}:${receiveMinor}`;
                    await apiClient.unifiedReceive(
                      receiveCurrency,
                      receiveMinor,
                      key(action)
                    );
                    delete keys.current[action];
                    setReceiveAmount("");
                    setQuote(null);
                    await snapshot.refetch();
                  });
                }}
              />
              <Typography weight="600" className="text-xl">
                Simulate Send
              </Typography>
              {choices(["USDC", "NGN"], destinationCurrency, (value) => {
                setDestinationCurrency(value);
                setDestination(value === "USDC" ? "test-wallet" : "test-bank");
                setQuote(null);
              })}
              <Typography>
                {destinationCurrency === "USDC"
                  ? "Crypto destination · USDC on Solana"
                  : "Bank destination · NGN"}
              </Typography>
              <TextInput
                accessibilityLabel="Test destination"
                maxLength={200}
                placeholder="Use a synthetic destination"
                value={destination}
                editable={!busy}
                onChangeText={(value) => {
                  setDestination(value);
                  setQuote(null);
                }}
                className={inputClass}
                autoCapitalize="none"
              />
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: sendAll }}
                disabled={busy}
                onPress={() => {
                  setSendAll(!sendAll);
                  setQuote(null);
                }}
              >
                <Typography className="py-2">
                  {sendAll ? "☑" : "☐"} Send all available holdings
                </Typography>
              </Pressable>
              {!sendAll && (
                <TextInput
                  accessibilityLabel="Recipient amount"
                  placeholder={`Recipient receives (${destinationCurrency})`}
                  keyboardType="decimal-pad"
                  editable={!busy}
                  value={amount}
                  onChangeText={(value) => {
                    setAmount(value);
                    setQuote(null);
                  }}
                  className={inputClass}
                />
              )}
              <ThemedButton
                title="Preview Send"
                disabled={
                  busy || !destination.trim() || (!sendAll && !recipientMinor)
                }
                onPress={() => {
                  void run(async () => {
                    setQuote(
                      await apiClient.unifiedQuote({
                        destinationCurrency,
                        destination: destination.trim(),
                        ...(sendAll
                          ? { sendAll: true as const }
                          : { recipientMinor: recipientMinor! }),
                      })
                    );
                  });
                }}
              />
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: manualSteps }}
                disabled={busy}
                onPress={() => setManualSteps(!manualSteps)}
              >
                <Typography>
                  {manualSteps ? "☑" : "☐"} Manual test steps (for testing
                  failures)
                </Typography>
              </Pressable>
              {quote && (
                <View className="gap-3 rounded-2xl border border-black/20 p-4">
                  <Typography weight="600">
                    Recipient receives{" "}
                    {unifiedMoney(
                      quote.plan.recipientMinor,
                      quote.plan.destinationCurrency
                    )}
                  </Typography>
                  <Typography>To: {quote.destination}</Typography>
                  <Typography>
                    Existing {quote.plan.destinationCurrency}:{" "}
                    {unifiedMoney(
                      quote.plan.directMinor,
                      quote.plan.destinationCurrency
                    )}
                  </Typography>
                  {quote.plan.conversion && (
                    <Typography>
                      Convert{" "}
                      {unifiedMoney(
                        quote.plan.conversion.sourceDebitMinor,
                        quote.plan.conversion.sourceCurrency
                      )}{" "}
                      into{" "}
                      {unifiedMoney(
                        quote.plan.conversion.destinationCreditMinor,
                        quote.plan.conversion.destinationCurrency
                      )}
                      . Conversion debit includes conversion fees.
                    </Typography>
                  )}
                  <Typography>
                    Send fee:{" "}
                    {unifiedMoney(
                      quote.plan.payoutFeeMinor,
                      quote.plan.destinationCurrency
                    )}
                  </Typography>
                  <Typography>
                    {Date.parse(quote.expiresAt) <= now
                      ? "Quote expired. Preview again."
                      : `Quote expires ${new Date(quote.expiresAt).toLocaleTimeString()}`}
                  </Typography>
                  <ThemedButton
                    title="Create simulated Send"
                    disabled={busy || Date.parse(quote.expiresAt) <= now}
                    onPress={() => {
                      void run(async () => {
                        await apiClient.unifiedCreateOrder(
                          quote.id,
                          key(`create:${quote.id}`),
                          !manualSteps
                        );
                        setQuote(null);
                        await snapshot.refetch();
                      });
                    }}
                  />
                </View>
              )}
              <Typography weight="600" className="text-xl">
                Test activity
              </Typography>
              {snapshot.data.orders.length === 0 && (
                <Typography>Your simulated Sends will appear here.</Typography>
              )}
              {snapshot.data.orders.map((order) => (
                <View
                  key={order.id}
                  className="gap-3 rounded-2xl border border-black/10 p-4"
                >
                  <Typography weight="600">
                    {unifiedMoney(
                      order.plan.recipientMinor,
                      order.plan.destinationCurrency
                    )}{" "}
                    · {order.status.replace(/_/g, " ")}
                  </Typography>
                  <Typography>{order.destination}</Typography>
                  <Typography>
                    {new Date(order.createdAt).toLocaleString()}
                  </Typography>
                  {order.status !== "completed" &&
                    order.status !== "failed" &&
                    !order.autoAdvance && (
                      <>
                        <ThemedButton
                          variant="quiet"
                          title={
                            order.status === "converting"
                              ? "Simulate conversion settling"
                              : order.status === "ready_to_send"
                                ? "Simulate sending"
                                : "Simulate delivery"
                          }
                          disabled={busy}
                          onPress={() => {
                            void run(async () => {
                              await apiClient.unifiedAdvance(
                                order.id,
                                "advance",
                                key(`${order.id}:${order.status}:advance`)
                              );
                              setQuote(null);
                              await snapshot.refetch();
                            });
                          }}
                        />
                        <ThemedButton
                          variant="quiet"
                          title="Simulate failure"
                          disabled={busy}
                          onPress={() => {
                            void run(async () => {
                              await apiClient.unifiedAdvance(
                                order.id,
                                "fail",
                                key(`${order.id}:${order.status}:fail`)
                              );
                              setQuote(null);
                              await snapshot.refetch();
                            });
                          }}
                        />
                      </>
                    )}
                </View>
              ))}
            </>
          )}
          {busy && <ActivityIndicator />}
          {error && (
            <Typography accessibilityRole="alert" className="text-red-700">
              {error}
            </Typography>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedScreen>
  );
}
