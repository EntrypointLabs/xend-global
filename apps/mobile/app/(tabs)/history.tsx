import React, { useCallback, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { ScreenLayout } from "@/components/ui/layout";
import {
  ActivityList,
  TransactionDetailModal,
} from "@/components/ui/organisms";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";
import { useTransfersInfinite, usePendingWatch } from "@/hooks/useTransfers";
import { useWalletAddress } from "@/hooks/useWalletAddress";
import { useBalances } from "@/hooks/useBalances";
import { useAwaitingPayments } from "@/hooks/useAwaitingPayments";
import {
  awaitingPaymentActivityEntry,
  groupIntoSections,
  mapAccountEventToActivityEntry,
  mapTransferRowToActivityEntry,
  type ActivityEntry,
} from "@/utils/activity";

export default function HistoryScreen() {
  const address = useWalletAddress();
  const { decimalsByMint, iconsByMint } = useBalances();
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
  } = useTransfersInfinite();

  const { data: awaiting } = useAwaitingPayments();

  const [selectedItem, setSelectedItem] = useState<ActivityEntry | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const transferRows = (
    data?.pages.flatMap((page) => page.transfers) ?? []
  ).map((row) =>
    mapTransferRowToActivityEntry(row, {
      selfAddress: address ?? "",
      decimalsByMint,
      iconsByMint,
    })
  );

  // Merged for display only. The events deliberately do not live in
  // `page.transfers`, because the balance chart walks that array and would
  // read an entry with no amount as a zero-value movement.
  const eventRows = (data?.pages.flatMap((page) => page.events) ?? []).map(
    (event) => mapAccountEventToActivityEntry(event, address ?? "")
  );

  // A Payment waiting on this phone, merged the same way and for the same
  // reason: nothing about it exists on chain, so it cannot arrive as a
  // transfer. It leaves the feed when it settles and the settled Payment
  // arrives in its place, so one Payment is never two rows at rest.
  const awaitingRows = (awaiting ?? []).map((payment) =>
    awaitingPaymentActivityEntry(payment, address ?? "")
  );

  const rows = [...transferRows, ...eventRows, ...awaitingRows].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );

  // Only a transfer can be in flight; an event is recorded after the fact.
  usePendingWatch(transferRows.some((row) => row.status === "pending"));

  const handleItemPress = useCallback((item: ActivityEntry) => {
    // An unfinished Payment is the one row here that is an instruction rather
    // than a record. There is no receipt to open, so it goes where it can be
    // finished instead.
    if (item.kind === "awaiting") {
      router.push("/settings/finish-payment" as never);
      return;
    }
    setSelectedItem(item);
    setModalVisible(true);
  }, []);

  const sections = groupIntoSections(rows).map((section) => ({
    ...section,
    data: section.data.map((item) => ({
      ...item,
      onPress: () => handleItemPress(item),
    })),
  }));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  return (
    <ScreenLayout>
      <TabHeaderText>Activity</TabHeaderText>
      <ActivityList
        sections={sections}
        onEndReached={() => fetchNextPage()}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onRefresh={onRefresh}
        refreshing={refreshing}
        ListEmptyComponent={
          isLoading ? (
            <View className="items-center py-16">
              <ActivityIndicator />
            </View>
          ) : undefined
        }
      />

      <TransactionDetailModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        item={selectedItem}
      />
    </ScreenLayout>
  );
}
