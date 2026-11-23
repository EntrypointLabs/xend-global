import React, { useMemo, useState } from "react";
import { ActivityIndicator, SectionList, TextInput, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { GlassButton } from "@/components/ui/atoms/Glass";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { TokenMark } from "@/components/ui/atoms/TokenMark";
import { Typography } from "@/components/ui/atoms/Typography";
import { PillButton } from "@/components/ui/kit/PillButton";
import { ScreenLayout } from "@/components/ui/layout";
import { useBalances } from "@/hooks/useBalances";
import { useFeature } from "@/hooks/useFeature";
import { usePalette } from "@/hooks/usePalette";
import { useSwapTokens } from "@/hooks/useSwapTokens";
import { formatRawAmount, type SwapToken } from "@/utils/swap";
import {
  heldSwapTokens,
  matchesTokenSearch,
  type HeldSwapToken,
} from "@/utils/swapTokens";
import { pickSwapToken, useSwapPair, type SwapSide } from "@/utils/swapPair";

interface Row {
  token: SwapToken;
  /** What the Account holds of it, in display units; absent when nothing. */
  balance?: string;
}

/**
 * Chooses the asset on one side of a swap.
 *
 * Paying can only be done with something held, so that side lists holdings
 * and nothing else. Receiving adds the verified assets Swap offers, with the
 * Consumer's own first because swapping back into one is the common case.
 */
export default function SwapTokenRoute() {
  const enabled = useFeature("swap");
  const { side } = useLocalSearchParams<{ side?: string }>();
  if (!enabled) return <Redirect href="/" />;
  return <SwapTokenPicker side={side === "receive" ? "receive" : "pay"} />;
}

function SwapTokenPicker({ side }: { side: SwapSide }) {
  const router = useRouter();
  const palette = usePalette();
  const pair = useSwapPair();
  const { tokens: balances } = useBalances();
  const [search, setSearch] = useState("");

  const offered = useSwapTokens(side === "receive" ? search : "");
  const held = useMemo(() => heldSwapTokens(balances), [balances]);

  const sections = useMemo(() => {
    const mine: Row[] = held
      .filter((token) => matchesTokenSearch(token, search))
      .map(asRow);
    if (side === "pay") return [{ title: "", data: mine }];

    const heldMints = new Set(held.map((token) => token.mint));
    const others: Row[] = offered.tokens
      .filter((token) => !heldMints.has(token.mint))
      .map((token) => ({ token }));
    return [
      { title: "Your tokens", data: mine },
      { title: search.trim() ? "Results" : "Popular", data: others },
    ].filter((section) => section.data.length > 0);
  }, [held, offered.tokens, search, side]);

  const pick = (token: SwapToken) => {
    pickSwapToken(side, token);
    router.back();
  };

  const waiting = side === "receive" && offered.isLoading;
  const empty = sections.every((section) => section.data.length === 0);

  return (
    <ScreenLayout className="px-0 pb-0">
      <View className="flex-row items-center justify-center py-2">
        <Typography variant="title1" weight="600">
          {side === "pay" ? "You pay" : "You receive"}
        </Typography>
      </View>

      <View className="mx-5 mb-2 mt-6 h-12 flex-row items-center gap-2 rounded-full bg-foreground/[0.04] px-4">
        <Ionicons name="search" size={16} color={palette.fg(0.45)} />
        <TextInput
          className="flex-1 py-0 font-inter-medium text-[15px] tracking-normal text-foreground"
          placeholder={side === "pay" ? "Search your tokens" : "Search tokens"}
          placeholderTextColor={palette.fg(0.55)}
          keyboardAppearance={palette.dark ? "dark" : "light"}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel="Search tokens"
        />
        {search ? (
          <HapticPressable
            onPress={() => setSearch("")}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={8}
          >
            <Ionicons name="close-circle" size={18} color={palette.fg(0.25)} />
          </HapticPressable>
        ) : null}
      </View>

      {side === "receive" && offered.failed && empty ? (
        <View className="mx-5 mt-4">
          <Typography weight="600" className="text-[16px] text-foreground">
            Could not load tokens
          </Typography>
          <Typography
            weight="500"
            className="mt-1 text-[14px] text-foreground/55"
          >
            Check your connection and try again.
          </Typography>
          <PillButton
            title="Try again"
            tone="quiet"
            size="sm"
            className="mt-4"
            onPress={() => void offered.retry()}
          />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(row) => row.token.mint}
          renderSectionHeader={({ section }) =>
            section.title ? (
              <View className="bg-background px-5 pb-1 pt-4">
                <Typography
                  weight="500"
                  className="text-[13px] text-foreground/55"
                >
                  {section.title}
                </Typography>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <TokenRow
              row={item}
              selected={item.token.mint === pair[side].mint}
              onPress={() => pick(item.token)}
            />
          )}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          contentContainerClassName="pb-10"
          ListFooterComponent={
            waiting ? (
              <View className="items-center py-10">
                <ActivityIndicator size="small" color={palette.fg(0.25)} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            waiting ? null : (
              <Typography
                weight="500"
                className="mx-5 py-10 text-center text-[15px] text-foreground/55"
              >
                {search.trim()
                  ? `No tokens match "${search.trim()}"`
                  : "Nothing to swap yet. Add money to your Account first."}
              </Typography>
            )
          }
        />
      )}

      <View className="absolute left-5 top-[16px]">
        <GlassButton
          radius={999}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          className="size-11 items-center justify-center rounded-full"
          fallbackClassName=""
        >
          <Ionicons name="chevron-back" size={22} color={palette.foreground} />
        </GlassButton>
      </View>
    </ScreenLayout>
  );
}

function asRow(token: HeldSwapToken): Row {
  return {
    token,
    balance: formatRawAmount(token.amountRaw, token.decimals),
  };
}

function TokenRow({
  row,
  selected,
  onPress,
}: {
  row: Row;
  selected: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  const { token, balance } = row;
  // A name that is already the ticker is not said twice.
  const detail = balance
    ? `${balance} ${token.symbol}`
    : token.symbol.toLowerCase() === token.name.toLowerCase()
      ? null
      : token.symbol;

  return (
    <HapticPressable
      onPress={onPress}
      feedback="selection"
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={
        balance
          ? `${token.name}, ${balance} ${token.symbol}`
          : `${token.name}, ${token.symbol}`
      }
      className="mx-5 h-16 flex-row items-center gap-3"
    >
      <TokenMark
        mint={token.mint}
        label={token.symbol}
        iconUrl={token.iconUrl}
        size={40}
      />
      <View className="flex-1">
        <Typography
          weight="600"
          numberOfLines={1}
          className="text-[16px] text-foreground"
        >
          {token.name}
        </Typography>
        {detail ? (
          <Typography
            weight="500"
            numberOfLines={1}
            className="text-[13px] text-foreground/55"
          >
            {detail}
          </Typography>
        ) : null}
      </View>
      {selected ? (
        <Ionicons name="checkmark" size={20} color={palette.foreground} />
      ) : null}
    </HapticPressable>
  );
}
