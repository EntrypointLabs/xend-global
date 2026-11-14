import React from "react";
import { View } from "react-native";

import { Typography } from "@/components/ui/atoms/Typography";
import { useSurface } from "@/components/ui/glass";
import { ActivityItem } from "@/components/ui/organisms/ActivityItem";
import type { ActivityEntry } from "@/utils/activity";
import { cn } from "@/utils/cn";
import { HomeSection } from "./HomeSection";

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
  const S = useSurface();
  return (
    <HomeSection
      title="Recent transactions"
      actionLabel={entries.length > 0 ? "See all" : undefined}
      onAction={onSeeAll}
    >
      <View
        className={cn("px-4 py-1", S.card)}
        // PLATFORM-SHADOW
        style={S.raised}
      >
        {entries.length === 0 ? (
          <Typography weight="500" className={cn("py-4 text-sm", S.copy)}>
            {loaded
              ? "Money you add and send shows up here"
              : "Loading your activity"}
          </Typography>
        ) : (
          entries.map((entry, index) => (
            // Rows split by the site card's own 12% hairline.
            <View
              key={entry.id}
              className={cn(index > 0 && "border-t", S.divider)}
            >
              <ActivityItem {...entry} onPress={() => onOpen(entry)} />
            </View>
          ))
        )}
      </View>
    </HomeSection>
  );
}
