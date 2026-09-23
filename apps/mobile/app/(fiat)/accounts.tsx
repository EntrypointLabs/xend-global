import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { router, Stack, type Href } from "expo-router";
import { useQuery } from "@tanstack/react-query";
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
import { useAuth } from "@/contexts/AuthContext";
import { useUserId } from "@/hooks/useUserId";
import { apiClient } from "@/utils/apiClient";
import { localFiatDemo } from "@/utils/local-fiat-demo";
import { BankAccountInputSchema } from "@/utils/bank-accounts";

export default function NairaAccountScreen() {
  const { isAuthenticated } = useAuth();
  const userId = useUserId();
  const accounts = useQuery({
    queryKey: [
      "fiat",
      "bank-accounts",
      localFiatDemo ? "local-sandbox" : userId,
    ],
    queryFn: () => apiClient.bankAccounts(),
    enabled: localFiatDemo || Boolean(isAuthenticated && userId),
    refetchInterval: 5000,
  });
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    bvn: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const input = BankAccountInputSchema.safeParse({
    ...form,
    bvn: form.bvn.trim() || undefined,
  });
  const selected = accounts.data?.accounts.find(
    (a) => a.provider === accounts.data?.provider
  );
  async function create() {
    if (!input.success || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await apiClient.createBankAccount(input.data);
      setForm((f) => ({ ...f, bvn: "" }));
      await accounts.refetch();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to create account. Refresh to check its status."
      );
      await accounts.refetch();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function reconcile(accountId: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const account = await apiClient.reconcileBankAccount(accountId);
      if (account.status === "needs_attention") {
        setError(
          "The provider has not confirmed this account yet. The original request is retained."
        );
      }
      await accounts.refetch();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to check account status."
      );
    } finally {
      inFlight.current = false;
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
            title="Naira account"
            subtitle="Receive naira with account details assigned to you."
          />
          <FiatNotice>
            This account is connected to the provider sandbox. Use only
            provider-approved test details and never send real money.
          </FiatNotice>
          <FiatLink
            icon="wallet-outline"
            title="View balances"
            subtitle="See observed bank and onchain balances"
            onPress={() => router.push("/(fiat)/balances" as Href)}
          />
          {accounts.data?.provider === "paga" && (
            <FiatLink
              icon="paper-plane-outline"
              title="Send naira"
              subtitle="To another Xend Paga account"
              onPress={() => router.push("/(fiat)/naira-send" as Href)}
            />
          )}
          {accounts.isLoading && <ActivityIndicator />}
          {accounts.isError && (
            <>
              <Typography>Could not load account status.</Typography>
              <ThemedButton
                title="Retry"
                onPress={() => {
                  void accounts.refetch();
                }}
              />
            </>
          )}
          {accounts.data && (
            <>
              <Typography>
                Provider: {accounts.data.provider ?? "Not configured"}
              </Typography>
              {!accounts.data.available && (
                <Typography>
                  Account creation is waiting for provider sandbox access. Your
                  backend needs the selected provider’s sandbox credentials.
                </Typography>
              )}
              {accounts.data.accounts.map((account) => (
                <FiatCard key={account.id} className="gap-3">
                  <Typography weight="600">
                    {account.provider} · {account.status.replace(/_/g, " ")}
                  </Typography>
                  {account.account && (
                    <>
                      <Typography>{account.account.bankName}</Typography>
                      <Typography weight="600" className="text-2xl">
                        {account.account.accountNumber}
                      </Typography>
                      <Typography>{account.account.accountName}</Typography>
                    </>
                  )}
                  {account.status === "creating" && (
                    <Typography>
                      The provider request is being processed. This page will
                      refresh automatically.
                    </Typography>
                  )}
                  {account.status === "needs_attention" && (
                    <>
                      <Typography>
                        The provider has not confirmed this account. Check the
                        original request to retrieve its account details.
                      </Typography>
                      {accounts.data.reconciliationAvailable &&
                        account.provider === accounts.data.provider && (
                          <ThemedButton
                            title={
                              busy
                                ? "Checking account…"
                                : "Check account status"
                            }
                            disabled={busy}
                            onPress={() => {
                              void reconcile(account.id);
                            }}
                          />
                        )}
                    </>
                  )}
                </FiatCard>
              ))}
              {!selected && accounts.data.available && (
                <>
                  <Typography>Create your provider sandbox account</Typography>
                  {(
                    [
                      ["firstName", "First name"],
                      ["lastName", "Last name"],
                      ["email", "Email"],
                      ["bvn", "Test BVN (if required by provider)"],
                    ] as const
                  ).map(([name, label]) => (
                    <FiatTextInput
                      key={name}
                      accessibilityLabel={label}
                      placeholder={label}
                      value={form[name]}
                      editable={!busy}
                      onChangeText={(value) =>
                        setForm((f) => ({ ...f, [name]: value }))
                      }
                      autoCapitalize={name === "email" ? "none" : "words"}
                      keyboardType={
                        name === "email"
                          ? "email-address"
                          : name === "bvn"
                            ? "number-pad"
                            : "default"
                      }
                      secureTextEntry={name === "bvn"}
                      maxLength={name === "bvn" ? 11 : 200}
                    />
                  ))}
                  <ThemedButton
                    title={
                      busy ? "Creating account…" : "Create sandbox account"
                    }
                    disabled={busy || !input.success}
                    onPress={() => {
                      void create();
                    }}
                  />
                </>
              )}
            </>
          )}
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
