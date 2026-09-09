import React, { useRef, useState, useEffect } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { router, Stack } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ThemedScreen } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import { ThemedButton } from "@/components/ui/molecules/ThemedButton";
import { useAuth } from "@/contexts/AuthContext";
import { useUserId } from "@/hooks/useUserId";
import { apiClient } from "@/utils/apiClient";
import { localFiatDemo } from "@/utils/local-fiat-demo";
import { fiatAmountMinor } from "@/utils/fiat";
import { unifiedMoney } from "@/utils/unified-fiat";
import type { NairaTransfer } from "@/utils/naira-transfers";
export default function NairaSendScreen() {
  const { isAuthenticated } = useAuth();
  const userId = useUserId();
  const cache = useQueryClient();
  const transfers = useQuery({
    queryKey: [
      "fiat",
      "naira-transfers",
      localFiatDemo ? "local-sandbox" : userId,
    ],
    queryFn: () => apiClient.nairaTransfers(),
    enabled: localFiatDemo || Boolean(isAuthenticated && userId),
    refetchInterval: 5000,
  });
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<NairaTransfer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const keys = useRef<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const minor = fiatAmountMinor(amount, 2);
  async function run(fn: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Transfer request failed. Refresh its status before retrying."
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
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
            Send naira
          </Typography>
          <Typography className="rounded-2xl bg-amber-50 p-4">
            Paga sandbox transfer. Both accounts must belong to Xend users in
            this sandbox. The provider moves test funds; this does not spend the
            unified simulator balance.
          </Typography>
          {transfers.isLoading && <ActivityIndicator />}
          {transfers.isError && (
            <>
              <Typography>Could not load transfers.</Typography>
              <ThemedButton
                title="Refresh"
                onPress={() => {
                  void transfers.refetch();
                }}
              />
            </>
          )}
          {transfers.data && !transfers.data.available && (
            <Typography>
              Transfers require configured Paga sandbox access and an active
              Paga account.
            </Typography>
          )}
          {transfers.data?.available && (
            <>
              <TextInput
                accessibilityLabel="Recipient Paga account number"
                placeholder="Recipient Paga account number"
                value={account}
                editable={!busy}
                keyboardType="number-pad"
                maxLength={10}
                onChangeText={(v) => {
                  setAccount(v);
                  setQuote(null);
                }}
                className="rounded-xl border border-black/20 px-4 py-3 text-base text-black"
              />
              <TextInput
                accessibilityLabel="Naira amount"
                placeholder="Amount in naira"
                value={amount}
                editable={!busy}
                keyboardType="decimal-pad"
                onChangeText={(v) => {
                  setAmount(v);
                  setQuote(null);
                }}
                className="rounded-xl border border-black/20 px-4 py-3 text-base text-black"
              />
              <ThemedButton
                title="Check recipient and preview"
                disabled={
                  busy ||
                  !/^\d{10}$/.test(account) ||
                  !minor ||
                  minor.length > 15
                }
                onPress={() => {
                  void run(async () => {
                    setQuote(
                      await apiClient.quoteNairaTransfer(account, minor!)
                    );
                  });
                }}
              />
            </>
          )}
          {quote && (
            <View className="gap-3 rounded-2xl border border-black/20 p-4">
              <Typography weight="600">
                {quote.destination.accountName}
              </Typography>
              <Typography>{quote.destination.accountNumber}</Typography>
              <Typography>{unifiedMoney(quote.amountMinor, "NGN")}</Typography>
              <Typography>
                Provider fee has not been quoted. This sandbox test requires the
                provider to report the exact principal debited and credited.
              </Typography>
              <ThemedButton
                title={
                  Date.parse(quote.expiresAt) <= now
                    ? "Preview expired"
                    : "Confirm sandbox transfer"
                }
                disabled={busy || Date.parse(quote.expiresAt) <= now}
                onPress={() => {
                  void run(async () => {
                    const key = (keys.current[quote.id] ??= randomUUID());
                    await apiClient.sendNairaTransfer(quote.id, key);
                    setQuote(null);
                    await transfers.refetch();
                    await cache.invalidateQueries({
                      queryKey: ["fiat", "observed-balances"],
                    });
                  });
                }}
              />
            </View>
          )}
          <Typography weight="600" className="text-xl">
            Transfers
          </Typography>
          {transfers.data?.transfers
            .filter((t) => t.status !== "quoted")
            .map((t) => (
              <View
                key={t.id}
                className="gap-3 rounded-2xl border border-black/20 p-4"
              >
                <Typography>
                  {unifiedMoney(t.amountMinor, "NGN")} ·{" "}
                  {t.status.replace(/_/g, " ")}
                </Typography>
                <Typography>
                  {t.destination.accountName} · {t.destination.accountNumber}
                </Typography>
                {t.status === "needs_attention" && (
                  <Typography>
                    The provider result needs reconciliation. Funds have not
                    been assumed returned, and this transfer will not be
                    submitted again automatically.
                  </Typography>
                )}
              </View>
            ))}
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
