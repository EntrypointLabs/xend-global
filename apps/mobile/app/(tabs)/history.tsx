import React, { useCallback, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { PhotoScreen, useSurface } from "@/components/ui/glass";
import { Typography } from "@/components/ui/atoms/Typography";
import { formatMoney } from "@/utils/balances";
import { cn } from "@/utils/cn";
import { summariseMonthlyFlow, type MonthlyFlow } from "@/utils/spentThisMonth";
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
    <PhotoScreen scene="sky" warm blurred>
      <TabHeaderText className="pb-0">Activity</TabHeaderText>
      <ActivityList
        ListHeaderComponent={
          <MonthHero flow={summariseMonthlyFlow(transferRows)} />
        }
        sections={sections}
        onEndReached={() => fetchNextPage()}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onRefresh={onRefresh}
        refreshing={refreshing}
        ListEmptyComponent={
          isLoading ? (
            <View className="items-center py-16">
              <ActivityIndicator color="#FFFFFF" />
            </View>
          ) : undefined
        }
      />

      <TransactionDetailModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        item={selectedItem}
      />
    </PhotoScreen>
  );
}

/**
 * This month's money in and out, over the open part of the photo. Gives the
 * screen a hero the way Revolut's tabs open, before the feed starts.
 */
function MonthHero({ flow }: { flow: MonthlyFlow }) {
  const S = useSurface();
  return (
    <View className="items-center pb-2 pt-10">
      <Typography weight="500" className={cn("text-[13px]", S.caption)}>
        This month
      </Typography>
      <View className="mt-3 w-full flex-row">
        <Figure label="Money in" amount={flow.inUsd} sign="+" />
        <View className="w-px bg-white/[0.18]" />
        <Figure label="Money out" amount={flow.outUsd} sign="-" />
      </View>
    </View>
  );
}

function Figure({
  label,
  amount,
  sign,
}: {
  label: string;
  amount: number;
  sign: "+" | "-";
}) {
  const S = useSurface();
  return (
    <View
      className="flex-1 items-center"
      accessible
      accessibilityLabel={`${label} this month, $${formatMoney(amount)}`}
    >
      <Typography
        weight="500"
        className={cn("text-[28px] leading-[105%] tracking-[-1.26px]", S.ink)}
      >
        {amount > 0 ? sign : ""}${formatMoney(amount)}
      </Typography>
      <Typography weight="500" className={cn("mt-1.5 text-[13px]", S.small)}>
        {label}
      </Typography>
    </View>
  );
}
