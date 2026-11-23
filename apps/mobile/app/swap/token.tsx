import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  SectionList,
  TextInput,
  View,
} from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassButton } from "@/components/ui/atoms/Glass";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { TokenMark } from "@/components/ui/atoms/TokenMark";
import { Typography } from "@/components/ui/atoms/Typography";
import { PillButton } from "@/components/ui/kit/PillButton";
import { ScreenLayout } from "@/components/ui/layout";
import { useBalances } from "@/hooks/useBalances";
import { useFeature } from "@/hooks/useFeature";
import { useKeyboardHeight } from "@/hooks/useKeyboardHeight";
import { usePalette } from "@/hooks/usePalette";
import { useSwapTokens } from "@/hooks/useSwapTokens";
import { cn } from "@/utils/cn";
import {
  formatRawAmount,
  formatTokenPrice,
  type SwapToken,
  type SwapTokenCategory,
} from "@/utils/swap";
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
  usdPrice: number | null;
}

/** `null` is the everyday list: the Consumer's own tokens and the popular ones. */
const SHELVES: { category: SwapTokenCategory | null; label: string }[] = [
  { category: null, label: "All" },
  { category: "crypto", label: "Crypto" },
  { category: "stable", label: "Stablecoins" },
  { category: "stocks", label: "Stocks" },
  { category: "meme", label: "Memes" },
];

/**
 * Chooses the asset on one side of a swap.
 *
 * Paying can only be done with something held, so that side lists holdings
 * and nothing else. Receiving adds the verified assets Swap offers, sorted
 * onto shelves so that tokenized stocks and meme tokens are a deliberate tap
 * away instead of sitting beside SOL.
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
  const [category, setCategory] = useState<SwapTokenCategory | null>(null);
  // The screen already stops short of the home indicator, so only the part
  // of the keyboard above that is new.
  const insets = useSafeAreaInsets();
  const keyboard = Math.max(0, useKeyboardHeight() - insets.bottom);

  const receiving = side === "receive";
  const searching = search.trim().length > 0;
  const offered = useSwapTokens(receiving ? search : "", category);
  const held = useMemo(() => heldSwapTokens(balances), [balances]);

  const sections = useMemo(() => {
    const mine = held.filter((token) => matchesTokenSearch(token, search));
    if (!receiving) return [{ title: "", data: mine.map(heldRow) }];

    const holdings = new Map(held.map((token) => [token.mint, token]));
    const listed: Row[] = offered.tokens.map((token) => {
      const own = holdings.get(token.mint);
      return own ? heldRow(own) : { token, usdPrice: token.usdPrice };
    });
    // A shelf is one list. A token the Consumer holds stays in its place on
    // it, with its balance, so the shelf reads the same for everyone.
    if (category && !searching) return [{ title: "", data: listed }];

    const others = listed.filter((row) => !holdings.has(row.token.mint));
    return [
      { title: "Your tokens", data: mine.map(heldRow) },
      { title: searching ? "Results" : "Popular", data: others },
    ].filter((section) => section.data.length > 0);
  }, [held, offered.tokens, search, searching, receiving, category]);

  const pick = (token: SwapToken) => {
    pickSwapToken(side, token);
    router.back();
  };

  const waiting = receiving && (offered.isLoading || offered.isStale);
  const empty = sections.every((section) => section.data.length === 0);

  return (
    <ScreenLayout className="px-0 pb-0">
      <View
        className="flex-1"
        // The search field sits at the bottom, exactly where the keyboard
        // opens, so the screen is shortened by the keyboard's measured height.
        style={{ paddingBottom: keyboard }}
      >
        <View className="flex-row items-center justify-center py-2">
          <Typography variant="title1" weight="600">
            {receiving ? "You receive" : "You pay"}
          </Typography>
        </View>

        {receiving ? (
          <View className="mt-4">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerClassName="gap-2 px-5"
            >
              {SHELVES.map((shelf) => {
                const selected = !searching && shelf.category === category;
                return (
                  <HapticPressable
                    key={shelf.label}
                    onPress={() => setCategory(shelf.category)}
                    disabled={searching}
                    feedback="selection"
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: searching }}
                    accessibilityLabel={shelf.label}
                    className={cn(
                      "h-9 items-center justify-center rounded-full px-4",
                      selected ? "bg-foreground" : "bg-foreground/[0.05]",
                      searching && "opacity-40"
                    )}
                  >
                    <Typography
                      weight="600"
                      className={cn(
                        "text-[14px]",
                        selected ? "text-background" : "text-foreground/70"
                      )}
                    >
                      {shelf.label}
                    </Typography>
                  </HapticPressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        <View className="flex-1">
          {receiving && offered.failed && empty ? (
            <View className="mx-5 mt-6">
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
                ) : (
                  <View className="h-2" />
                )
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
              contentContainerClassName="pb-4"
              ListEmptyComponent={
                waiting ? (
                  <View className="items-center py-10">
                    <ActivityIndicator size="small" color={palette.fg(0.25)} />
                  </View>
                ) : (
                  <Typography
                    weight="500"
                    className="mx-5 py-10 text-center text-[15px] text-foreground/55"
                  >
                    {searching
                      ? `No tokens match "${search.trim()}"`
                      : receiving
                        ? "Nothing to show here right now."
                        : "Nothing to swap yet. Add money to your Account first."}
                  </Typography>
                )
              }
            />
          )}
        </View>

        <View className="mx-5 mb-2 mt-2 h-12 flex-row items-center gap-2 rounded-full bg-foreground/[0.05] px-4">
          <Ionicons name="search" size={16} color={palette.fg(0.45)} />
          <TextInput
            className="flex-1 py-0 font-inter-medium text-[15px] tracking-normal text-foreground"
            placeholder={receiving ? "Search tokens" : "Search your tokens"}
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
              <Ionicons
                name="close-circle"
                size={18}
                color={palette.fg(0.25)}
              />
            </HapticPressable>
          ) : null}
        </View>
      </View>

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

function heldRow(token: HeldSwapToken): Row {
  return {
    token,
    balance: formatRawAmount(token.amountRaw, token.decimals),
    usdPrice: token.usdPrice,
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
  const { token, balance, usdPrice } = row;
  // A name that is already the ticker is not said twice.
  const detail = balance
    ? `${balance} ${token.symbol}`
    : token.symbol.toLowerCase() === token.name.toLowerCase()
      ? null
      : token.symbol;
  const price = usdPrice === null ? null : formatTokenPrice(usdPrice);

  return (
    <HapticPressable
      onPress={onPress}
      feedback="selection"
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={[token.name, detail, price]
        .filter(Boolean)
        .join(", ")}
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
      {price ? (
        <Typography weight="500" className="text-[14px] text-foreground/55">
          {price}
        </Typography>
      ) : null}
      {selected ? (
        <Ionicons name="checkmark" size={20} color={palette.foreground} />
      ) : null}
    </HapticPressable>
  );
}
