import React, { memo, useCallback, useState } from "react";
import { StyleSheet, SectionList, RefreshControl } from "react-native";
import { ActivityItem } from "./ActivityItem";
import { Spacing } from "@/constants/Spacing";
import { History } from "@/types/History";
import { Typography } from "../atoms/Typography";

type HistoryWithHandler = History & {
  onPress?: () => void;
};

export interface ActivitySection {
  title: string;
  data: HistoryWithHandler[];
}

interface ActivityListProps {
  sections: ActivitySection[];
}

export const ActivityList = memo(({ sections }: ActivityListProps) => {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // TODO: Add refresh logic
    setTimeout(() => {
      setRefreshing(false);
    }, 1000);
  }, []);

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item, index) => item.id + index}
      renderItem={({ item }) => <ActivityItem {...item} />}
      renderSectionHeader={({ section: { title } }) => (
        <Typography weight="600" className="text-sm text-black/30">
          {title}
        </Typography>
      )}
      contentContainerStyle={styles.contentContainer}
      stickySectionHeadersEnabled={false}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
      windowSize={10}
      maxToRenderPerBatch={10}
      updateCellsBatchingPeriod={16}
      removeClippedSubviews
      initialNumToRender={20}
    />
  );
});

ActivityList.displayName = "ActivityList";

const styles = StyleSheet.create({
  contentContainer: {
    paddingBottom: 70,
  },
});
