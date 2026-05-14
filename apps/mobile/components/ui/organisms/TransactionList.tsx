import React from "react";
import { View, ScrollView, RefreshControl } from "react-native";
import { ThemedText } from "@/components/ui/atoms";
import { TransactionItem } from "./TransactionItem";
import { TransactionGroup } from "@/types/Transaction";

interface TransactionListProps {
  transactions: TransactionGroup[];
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
              <View className="z-10 bg-background px-4 pt-8">
                <ThemedText type="defaultSemiBold" className="opacity-25">
                  {section.title}
                </ThemedText>
              </View>
              {section.data.map((item, index) => (
                <TransactionItem
                  key={item.id}
                  type={item.type}
                  date={item.date.toLocaleDateString()}
                  amount={item.amount}
                  address={item.address}
                  isLast={index === section.data.length - 1}
                  status={item.status}
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
