import React, { useState } from "react";
import { View } from "react-native";
import { ScreenLayout } from "@/components/ui/layout";
import {
  ActivityList,
  ActivitySection,
  TransactionDetailModal,
} from "@/components/ui/organisms";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";
import { History } from "@/types/History";

// Mock Assets
const ICONS = {
  usdc: require("@/assets/icons/usdc.png"),
  solana: require("@/assets/icons/wallet.png"),
  earn: require("@/assets/icons/earn.png"),
  swap: require("@/assets/icons/redo.png"),
  key: require("@/assets/icons/card.png"),
};

const data: History[] = Array(10)
  .fill({
    id: "1",
    type: "transaction",
    side: "send", // send or receive or swap or card-deposit or card-withdraw
    amount: "10000000",
    token: {
      name: "USD Coin",
      symbol: "USDC",
      decimal: 6,
      icon: ICONS.usdc,
    },
    from: "CZ2R74BnKNHhjVw83jPV1FRx1CUvZjaz5DGMUS5tK4Aj",
    to: "AtfW8YJC4mdzi9iZyEd8KaPSyxmWQjwvmVCJMYRm8DtK",
    fee: {
      amount: "10000000",
      token: {
        name: "USD Coin",
        symbol: "USDC",
        decimal: 6,
        icon: "",
      },
    }, // null when incognito
    incognito: false,
    status: "success",
    date: "Oct 3, 2025 at 10:30 AM",
    transactionHash:
      "4rbUpiz58uJZXPmXtekEPcT9KpkWRbAzGCZRvu63Yfr6SDYcYznpxmwmqkcfHi6Xdk4FdR6315PwU75iXhP11w8a",
  })
  .map((item, index) => ({
    ...item,
    id: index.toString(),
    date: new Date(
      Date.now() - Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 30)
    ).toISOString(),
    side: Math.random() < 0.5 ? "send" : "receive",
    amount: Math.floor(Math.random() * 10000000).toString(),
    incognito: Math.random() < 0.5,
  }));

export default function HistoryScreen() {
  const [selectedItem, setSelectedItem] = useState<History | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  // Handler for item press
  const handleItemPress = (item: History) => {
    setSelectedItem(item);
    setModalVisible(true);
  };

  const sections = data.reduce(
    (acc, item) => {
      const day = new Date(item.date).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      const existingSection = acc.find((section) => section.title === day);
      if (existingSection) {
        existingSection.data.push(item);
      } else {
        acc.push({
          title: day,
          data: [item],
        });
      }
      return acc;
    },
    [] as { title: string; data: History[] }[]
  );

  const sectionsWithHandlers = sections.map((section) => ({
    ...section,
    data: section.data.map((item) => ({
      ...item,
      onPress: () => handleItemPress(item),
    })),
  }));

  return (
    <ScreenLayout>
      <TabHeaderText>Activity</TabHeaderText>
      <ActivityList sections={sectionsWithHandlers} />

      <TransactionDetailModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        item={selectedItem}
      />
    </ScreenLayout>
  );
}
