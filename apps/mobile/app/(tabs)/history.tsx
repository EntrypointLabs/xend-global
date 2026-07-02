import React, { useCallback, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { ScreenLayout } from "@/components/ui/layout";
import {
  ActivityList,
  TransactionDetailModal,
} from "@/components/ui/organisms";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";
import { useTransfersInfinite, usePendingWatch } from "@/hooks/useTransfers";
import { useWalletAddress } from "@/hooks/useWalletAddress";
import { useBalances } from "@/hooks/useBalances";
import {
  groupIntoSections,
  mapTransferRowToActivityEntry,
  type ActivityEntry,
} from "@/utils/activity";

export default function HistoryScreen() {
  const address = useWalletAddress();
  const { decimalsByMint } = useBalances();
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
  } = useTransfersInfinite();

  const [selectedItem, setSelectedItem] = useState<ActivityEntry | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const rows = (data?.pages.flatMap((page) => page.transfers) ?? []).map(
    (row) =>
      mapTransferRowToActivityEntry(row, {
        selfAddress: address ?? "",
        decimalsByMint,
      })
  );

  usePendingWatch(rows.some((row) => row.status === "pending"));

  const handleItemPress = useCallback((item: ActivityEntry) => {
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
