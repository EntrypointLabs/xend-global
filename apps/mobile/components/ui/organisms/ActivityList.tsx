import React, { memo } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  View,
} from "react-native";
import { ActivityItem } from "./ActivityItem";
import { Typography } from "../atoms/Typography";
import type { ActivityEntry } from "@/utils/activity";

type ActivityRow = ActivityEntry & {
  onPress?: () => void;
};

export interface ActivitySection {
  title: string;
  data: ActivityRow[];
}

interface ActivityListProps {
  sections: ActivitySection[];
  onEndReached?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  isFetchingNextPage?: boolean;
  hasNextPage?: boolean;
  ListEmptyComponent?: React.ReactElement | null;
}

// The grouping key is a `YYYY-MM-DD` day; render it as a readable date. Build
// the Date from its parts (local midnight) so the label names the same
// calendar day it was bucketed under, regardless of the device timezone.
function formatSectionTitle(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export const ActivityList = memo(
  ({
    sections,
    onEndReached,
    onRefresh,
    refreshing = false,
    isFetchingNextPage = false,
    hasNextPage = false,
    ListEmptyComponent,
  }: ActivityListProps) => {
    const emptyState = ListEmptyComponent ?? (
      <View className="items-center py-16">
        <Typography weight="500" className="text-black/30">
          No activity yet
        </Typography>
      </View>
    );

    return (
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ActivityItem {...item} />}
        renderSectionHeader={({ section: { title } }) => (
          <Typography weight="600" className="text-sm text-black/30">
            {formatSectionTitle(title)}
          </Typography>
        )}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) onEndReached?.();
        }}
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          ) : undefined
        }
        ListEmptyComponent={emptyState}
        ListFooterComponent={
          isFetchingNextPage ? (
            <View className="py-4">
              <ActivityIndicator />
            </View>
          ) : null
        }
        contentContainerClassName="pb-[70px]"
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        windowSize={10}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={16}
        removeClippedSubviews
        initialNumToRender={20}
      />
    );
  }
);

ActivityList.displayName = "ActivityList";
