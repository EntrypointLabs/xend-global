import React, { useCallback, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { PhotoScreen, useSurface } from "@/components/ui/glass";
import { Typography } from "@/components/ui/atoms/Typography";
import { formatMoney } from "@/utils/balances";
import { cn } from "@/utils/cn";
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- MonthHero is hidden for now
import { summariseMonthlyFlow, type MonthlyFlow } from "@/utils/spentThisMonth";
import {
  ActivityList,
  TransactionDetailModal,
} from "@/components/ui/organisms";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";
import { useTransfersInfinite, usePendingWatch } from "@/hooks/useTransfers";
import { useWalletAddress } from "@/hooks/useWalletAddress";
import { useCollapseOnScroll } from "@/hooks/useTabBarCollapse";
import { useBalances } from "@/hooks/useBalances";
import {
  useAwaitingPayments,
  useCanSeeAwaitingPayments,
} from "@/hooks/useAwaitingPayments";
import {
  awaitingPaymentActivityEntry,
  groupIntoSections,
  mapAccountEventToActivityEntry,
  mapTransferRowsToActivityEntries,
  type ActivityEntry,
} from "@/utils/activity";
import { requestApproval } from "@/utils/approvalRequests";

export default function HistoryScreen() {
  const address = useWalletAddress();
  const collapseOnScroll = useCollapseOnScroll();
  const { decimalsByMint, iconsByMint } = useBalances();
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
  } = useTransfersInfinite();

  const { data: awaiting, refetch: refetchAwaiting } = useAwaitingPayments();
  const canSeeAwaiting = useCanSeeAwaitingPayments();

  const [selectedItem, setSelectedItem] = useState<ActivityEntry | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const transferRows = mapTransferRowsToActivityEntries(
    data?.pages.flatMap((page) => page.transfers) ?? [],
    { selfAddress: address ?? "", decimalsByMint, iconsByMint }
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
      requestApproval(item.id.replace(/^awaiting:/, ""));
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
      // Everything the feed shows, so a pull also catches a Payment that
      // started or finished waiting on this phone.
      // refetch() ignores a query's `enabled`, so the gate is repeated here.
      await Promise.all([
        refetch(),
        canSeeAwaiting ? refetchAwaiting() : undefined,
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refetchAwaiting, canSeeAwaiting]);

  return (
    <PhotoScreen scene="sky" warm blurred>
      <TabHeaderText>Activity</TabHeaderText>
      <ActivityList
        {...collapseOnScroll}
        // Hidden for now; restore to bring back the month's money in and out.
        // ListHeaderComponent={
        //   <MonthHero flow={summariseMonthlyFlow(transferRows)} />
        // }
        sections={sections}
        onEndReached={() => fetchNextPage()}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onRefresh={onRefresh}
        refreshing={refreshing}
        ListEmptyComponent={isLoading ? <LoadingRow /> : undefined}
      />

      <TransactionDetailModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        item={selectedItem}
      />
    </PhotoScreen>
  );
}

function LoadingRow() {
  const S = useSurface();
  return (
    <View className="items-center py-16">
      <ActivityIndicator color={S.colors.ink} />
    </View>
  );
}

/**
 * This month's money in and out, over the open part of the photo. Gives the
 * screen a hero the way Revolut's tabs open, before the feed starts.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- hidden for now, see ListHeaderComponent
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
