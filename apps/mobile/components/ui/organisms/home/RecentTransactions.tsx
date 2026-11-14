import React from "react";
import { View } from "react-native";

import { Typography } from "@/components/ui/atoms/Typography";
import { ActivityItem } from "@/components/ui/organisms/ActivityItem";
import type { ActivityEntry } from "@/utils/activity";
import { HomeSection } from "./HomeSection";
import { RAISED } from "./surface";

interface RecentTransactionsProps {
  entries: ActivityEntry[];
  loaded: boolean;
  onSeeAll: () => void;
  onOpen: (entry: ActivityEntry) => void;
}

export function RecentTransactions({
  entries,
  loaded,
  onSeeAll,
  onOpen,
}: RecentTransactionsProps) {
  return (
    <HomeSection
      title="Recent transactions"
      actionLabel={entries.length > 0 ? "See all" : undefined}
      onAction={onSeeAll}
    >
      <View
        className="rounded-2xl bg-card px-4 py-1"
        // PLATFORM-SHADOW
        style={RAISED}
      >
        {entries.length === 0 ? (
          <Typography weight="500" className="py-4 text-sm text-black/40">
            {loaded
              ? "Money you add and send shows up here"
              : "Loading your activity"}
          </Typography>
        ) : (
          entries.map((entry) => (
            <ActivityItem
              key={entry.id}
              {...entry}
              onPress={() => onOpen(entry)}
            />
          ))
        )}
      </View>
    </HomeSection>
  );
}
