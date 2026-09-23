import React from "react";
import { ActivityIndicator, ScrollView } from "react-native";
import { router, Stack, type Href } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ScreenLayout } from "@/components/ui/layout";
import {
  FiatCard,
  FiatHeader,
  FiatLink,
  FiatNotice,
} from "@/components/fiat/FiatUI";
import { Typography } from "@/components/ui/atoms/Typography";
import { ThemedButton } from "@/components/ui/molecules/ThemedButton";
import { useAuth } from "@/contexts/AuthContext";
import { useUserId } from "@/hooks/useUserId";
import { localFiatDemo } from "@/utils/local-fiat-demo";
import { apiClient } from "@/utils/apiClient";
import { unifiedMoney } from "@/utils/unified-fiat";

export default function ObservedBalancesScreen() {
  const { isAuthenticated } = useAuth();
  const userId = useUserId();
  const balances = useQuery({
    queryKey: [
      "fiat",
      "observed-balances",
      localFiatDemo ? "local-sandbox" : userId,
    ],
    queryFn: () => apiClient.observedBalances(),
    enabled: localFiatDemo || Boolean(isAuthenticated && userId),
    refetchInterval: 30000,
  });
  return (
    <ScreenLayout>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="gap-5 pb-12"
      >
        <FiatHeader
          title="Balances"
          subtitle="Your bank and onchain money, observed independently."
        />
        <FiatNotice>
          These amounts are read from your provider sandbox and owned Solana
          account. They are never treated as spendable without reconciliation.
        </FiatNotice>
        {balances.isLoading && <ActivityIndicator />}
        {balances.isError && (
          <Typography accessibilityRole="alert">
            Could not load account balances. Try refreshing.
          </Typography>
        )}
        {balances.data && (
          <>
            <Typography weight="700" className="text-[36px] tracking-[-1px]">
              {balances.data.total
                ? unifiedMoney(balances.data.total.amountMinor, "USD")
                : "Total unavailable"}
            </Typography>
            <Typography>
              {balances.data.total
                ? "Estimated total using a provider quote. This is not a transferable amount or a confirmed conversion rate."
                : "A combined total requires both balances and a current exchange quote from matching test environments."}
            </Typography>
            <Typography>
              Bank: sandbox · Solana:{" "}
              {balances.data.network ?? "not configured"}
            </Typography>
            {balances.data.holdings.map((h) => (
              <FiatCard key={h.currency} className="gap-3">
                <Typography weight="600" className="text-xl">
                  {h.amountMinor === null
                    ? `${h.currency} unavailable`
                    : unifiedMoney(h.amountMinor, h.currency)}
                </Typography>
                {h.observedAt && (
                  <Typography>
                    Observed {new Date(h.observedAt).toLocaleTimeString()}
                  </Typography>
                )}
                {h.status === "unavailable" && (
                  <Typography>
                    {h.currency === "NGN"
                      ? "An owned account with a supported provider balance API is needed."
                      : "An owned Solana account and a working connection are needed."}
                  </Typography>
                )}
                {__DEV__ && h.reason && (
                  <Typography>{h.reason.replace(/_/g, " ")}</Typography>
                )}
              </FiatCard>
            ))}
            {__DEV__ && balances.data.valuationReason && (
              <Typography>
                {balances.data.valuationReason.replace(/_/g, " ")}
              </Typography>
            )}
          </>
        )}
        <ThemedButton
          title={balances.isFetching ? "Refreshing…" : "Refresh balances"}
          disabled={balances.isFetching}
          onPress={() => {
            void balances.refetch();
          }}
        />
        <FiatLink
          icon="business-outline"
          title="Naira account"
          subtitle="View account number and provider status"
          onPress={() => router.push("/(fiat)/accounts" as Href)}
        />
      </ScrollView>
    </ScreenLayout>
  );
}
