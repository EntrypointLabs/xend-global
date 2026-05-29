import React from "react";
import { View, ScrollView, RefreshControl } from "react-native";
import { ThemedText } from "@/components/ui/atoms";
import { TransactionItem } from "./TransactionItem";
import type { Transaction } from "@/types/Transaction";

// A row in the list is just a Transaction with an optional onPress handler the
// parent screen attaches when it needs detail-modal behavior.
type TransactionRow = Transaction & { onPress?: () => void };

export interface TransactionListGroup {
  title: string;
  data: TransactionRow[];
}

interface TransactionListProps {
  transactions: TransactionListGroup[];
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function TransactionList({
  transactions,
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
        {transactions.length === 0 ? (
          <ThemedText className="mt-8 text-center opacity-50">
            No transactions yet
          </ThemedText>
        ) : (
          transactions.map((section) => (
            <View key={section.title}>
              <View className="z-[1] bg-background px-4 pt-8">
                <ThemedText type="defaultSemiBold" className="opacity-[0.23]">
                  {section.title}
                </ThemedText>
              </View>
              {section.data.map((item, index) => (
                <TransactionItem
                  key={item.id}
                  item={item}
                  isLast={index === section.data.length - 1}
                  onPress={item.onPress}
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
