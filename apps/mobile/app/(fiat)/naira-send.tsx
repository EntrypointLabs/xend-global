import React, { useRef, useState, useEffect } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Stack } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ScreenLayout } from "@/components/ui/layout";
import {
  FiatCard,
  FiatHeader,
  FiatNotice,
  FiatTextInput,
} from "@/components/fiat/FiatUI";
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
  const requestKey = (name: string) => (keys.current[name] ??= randomUUID());
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
    <ScreenLayout>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerClassName="gap-5 pb-12"
          keyboardShouldPersistTaps="handled"
        >
          <FiatHeader
            title="Send naira"
            subtitle="Send to another Xend account securely."
          />
          <FiatNotice>
            Paga sandbox transfer. Both accounts must belong to Xend users in
            this sandbox. Never use real funds or account details here.
          </FiatNotice>
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
              <FiatTextInput
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
              />
              <FiatTextInput
                accessibilityLabel="Naira amount"
                placeholder="Amount in naira"
                value={amount}
                editable={!busy}
                keyboardType="decimal-pad"
                onChangeText={(v) => {
                  setAmount(v);
                  setQuote(null);
                }}
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
                      await apiClient.quoteNairaTransfer(
                        account,
                        minor!,
                        requestKey(`quote:${account}:${minor}`)
                      )
                    );
                  });
                }}
              />
            </>
          )}
          {quote && (
            <FiatCard className="gap-3 bg-black/[0.025]">
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
            </FiatCard>
          )}
          <Typography weight="600" className="text-xl">
            Transfers
          </Typography>
          {transfers.data?.transfers
            .filter((t) => t.status !== "quoted")
            .map((t) => (
              <FiatCard key={t.id} className="gap-3">
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
              </FiatCard>
            ))}
          {error && (
            <Typography accessibilityRole="alert" className="text-red-700">
              {error}
            </Typography>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenLayout>
  );
}
