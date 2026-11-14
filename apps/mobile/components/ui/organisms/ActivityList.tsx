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
import { cn } from "@/utils/cn";
import { GLASS, groupedRowClass, useOnPhoto } from "@/components/ui/glass";

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
  ListHeaderComponent?: React.ReactElement | null;
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
    ListHeaderComponent,
  }: ActivityListProps) => {
    const onPhoto = useOnPhoto();
    const emptyState = ListEmptyComponent ?? (
      <View className="items-center py-16">
        <Typography
          weight="500"
          className={onPhoto ? GLASS.copy : "text-black/30"}
        >
          No activity yet
        </Typography>
      </View>
    );

    return (
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={ListHeaderComponent}
        renderItem={({ item, index, section }) =>
          onPhoto ? (
            // On the photo each day is one glass card.
            <View
              className={cn(
                groupedRowClass(index, section.data.length),
                index > 0 && "border-t border-t-white/[0.12]"
              )}
            >
              <ActivityItem {...item} />
            </View>
          ) : (
            <ActivityItem {...item} />
          )
        }
        renderSectionHeader={({ section: { title } }) => (
          <Typography
            weight="600"
            className={cn(
              "text-sm",
              onPhoto ? cn("pb-2 pt-5", GLASS.caption) : "text-black/30"
            )}
          >
            {formatSectionTitle(title)}
          </Typography>
        )}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) onEndReached?.();
        }}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={onPhoto ? "#FFFFFF" : undefined}
            />
          ) : undefined
        }
        ListEmptyComponent={emptyState}
        ListFooterComponent={
          isFetchingNextPage ? (
            <View className="py-4">
              <ActivityIndicator color={onPhoto ? "#FFFFFF" : undefined} />
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
        // A phone shows about nine of these; rendering twenty up front just
        // made the Activity tab wait on eleven rows nobody had scrolled to.
        initialNumToRender={10}
      />
    );
  }
);

ActivityList.displayName = "ActivityList";
