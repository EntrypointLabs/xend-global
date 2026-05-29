import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { ScreenLayout } from "@/components/ui/layout";
import { TransactionDetailModal } from "@/components/ui/organisms";
import { TransactionList } from "@/components/ui/organisms/TransactionList";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";
import { ThemedText, LoadingSpinner } from "@/components/ui/atoms";
import { useWalletQuery } from "@/queries/useWalletQuery";
import { useTransactionsQuery } from "@/queries/useTransactionsQuery";
import { groupByDate } from "@/utils/groupByDate";
import type { Transaction } from "@/types/Transaction";

export default function HistoryScreen() {
  const {data: wallet, isLoading: isLoadingWallet} = useWalletQuery();
  const {data: transactions = [], isLoading: isLoadingTransactions} = useTransactionsQuery({
    gridAccountId: wallet?.gridAccountId ?? "",
  });

  const [selectedItem, setSelectedItem] = useState<Transaction | null>(null);

  const groups = useMemo(() => groupByDate(transactions), [transactions]);

  // Attach the row-press handler to each transaction in the group.
  const groupsWithHandlers = useMemo(
    () =>
      groups.map((g) => ({
        ...g,
        data: g.data.map((tx) => ({
          ...tx,
          onPress: () => setSelectedItem(tx),
        })),
      })),
    [groups],
  );

  const isLoading = isLoadingTransactions || isLoadingWallet;

  return (
    <ScreenLayout>
      <TabHeaderText>Activity</TabHeaderText>
      {isLoading ? (
        <View className="items-center pt-12">
          <LoadingSpinner />
          <ThemedText className="mt-4 opacity-50">
            Loading activity…
          </ThemedText>
        </View>
      ) : transactions.length === 0 ? (
        <ThemedText className="mt-12 text-center opacity-50">
          No transactions yet
        </ThemedText>
      ) : (
        <TransactionList transactions={groupsWithHandlers} />
      )}

      <TransactionDetailModal
        visible={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        item={selectedItem}
      />
    </ScreenLayout>
  );
}
