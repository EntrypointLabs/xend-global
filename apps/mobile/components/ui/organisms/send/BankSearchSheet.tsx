import React, { forwardRef, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetFlatList,
  BottomSheetModal,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { BlurBackdrop } from "@/components/ui/molecules/BlurBackdrop";
import { PillButton } from "@/components/ui/kit";
import type { Bank } from "@/utils/bank-directory";
import { BankLogo } from "./BankLogo";
import { BANK_SHEET_BG } from "./BankSheetParts";

const ROW_HEIGHT = 60;

function matchesSearch(name: string, query: string): boolean {
  const haystack = name.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** Every payout bank, searchable, over the send sheet. */
export const BankSearchSheet = forwardRef<
  BottomSheetModal,
  {
    banks: Bank[];
    loading: boolean;
    failed: boolean;
    onRetry: () => void;
    onPick: (bank: Bank) => void;
  }
>(({ banks, loading, failed, onRetry, onPick }, ref) => {
  const [search, setSearch] = useState("");
  const snapPoints = useMemo(() => ["86%"], []);
  const filtered = search
    ? banks.filter((bank) => matchesSearch(bank.name, search))
    : banks;
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => <BlurBackdrop {...props} />,
    []
  );

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      stackBehavior="push"
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      onDismiss={() => setSearch("")}
      backgroundStyle={{ backgroundColor: BANK_SHEET_BG }}
      containerStyle={{ zIndex: 2 }}
    >
      <View className="flex-1">
        <Typography
          accessibilityRole="header"
          weight="700"
          className="px-5 pt-2 text-[24px] leading-[30px] tracking-[-0.5px] text-[#0E0F0C]"
        >
          Choose bank
        </Typography>
        <View className="mx-5 mb-2 mt-4 h-12 flex-row items-center gap-2 rounded-full bg-black/[0.04] px-4">
          <Ionicons name="search" size={16} color="#00000073" />
          <BottomSheetTextInput
            className="flex-1 py-0 font-inter-medium text-[15px] tracking-normal text-[#0E0F0C]"
            placeholder="Search banks"
            placeholderTextColor="#0000008C"
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {search ? (
            <HapticPressable
              onPress={() => setSearch("")}
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={18} color="#00000040" />
            </HapticPressable>
          ) : null}
        </View>
        {loading ? (
          <View className="items-center py-10">
            <ActivityIndicator size="small" color="#00000040" />
          </View>
        ) : failed ? (
          <View className="mx-5 mt-4">
            <Typography weight="600" className="text-[16px] text-black">
              Could not load banks
            </Typography>
            <Typography weight="500" className="mt-1 text-[14px] text-black/55">
              Check your connection and try again.
            </Typography>
            <PillButton
              title="Try again"
              tone="quiet"
              size="sm"
              className="mt-4"
              onPress={onRetry}
            />
          </View>
        ) : (
          <BottomSheetFlatList
            data={filtered}
            keyExtractor={(bank: Bank) => bank.code}
            renderItem={({ item }: { item: Bank }) => (
              <HapticPressable
                onPress={() => onPick(item)}
                accessibilityRole="button"
                accessibilityLabel={item.name}
                className="mx-5 h-[60px] flex-row items-center gap-3"
              >
                <BankLogo name={item.name} logoKey={item.logoKey} />
                <Typography
                  weight="500"
                  numberOfLines={1}
                  className="flex-1 text-[15px] text-[#0E0F0C]"
                >
                  {item.name}
                </Typography>
              </HapticPressable>
            )}
            getItemLayout={(_: unknown, index: number) => ({
              length: ROW_HEIGHT,
              offset: ROW_HEIGHT * index,
              index,
            })}
            initialNumToRender={16}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <Typography
                weight="500"
                className="mx-5 py-10 text-center text-[15px] text-black/55"
              >
                {`No banks match "${search}"`}
              </Typography>
            }
          />
        )}
      </View>
    </BottomSheetModal>
  );
});

BankSearchSheet.displayName = "BankSearchSheet";
