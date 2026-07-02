import React from "react";
import { View, ScrollView, RefreshControl } from "react-native";
import { ThemedText } from "@/components/ui/atoms";
import { TransactionItem } from "./TransactionItem";
import type { ActivitySection } from "@/utils/activity";

interface TransactionListProps {
  sections: ActivitySection[];
  onRefresh?: () => void;
  refreshing?: boolean;
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

export function TransactionList({
  sections,
  onRefresh,
  refreshing,
}: TransactionListProps) {
  return (
    <View className="w-full flex-1">
      <ScrollView
        className="flex-1"
        contentContainerClassName="flex-grow"
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing || false}
              onRefresh={onRefresh}
            />
          ) : undefined
        }
      >
        {sections.length === 0 ? (
          <ThemedText className="mt-8 text-center opacity-50">
            No transactions yet
          </ThemedText>
        ) : (
          sections.map((section) => (
            <View key={section.title}>
              <View className="z-[1] bg-background px-4 pt-8">
                <ThemedText type="defaultSemiBold" className="opacity-[0.23]">
                  {formatSectionTitle(section.title)}
                </ThemedText>
              </View>
              {section.data.map((item, index) => (
                <TransactionItem
                  key={item.id}
                  {...item}
                  isLast={index === section.data.length - 1}
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
