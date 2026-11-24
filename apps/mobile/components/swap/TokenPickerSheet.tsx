import React, { forwardRef, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { FontAwesome6, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  BottomSheetFooter,
  BottomSheetModal,
  BottomSheetSectionList,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
  type BottomSheetFooterProps,
} from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { TokenMark } from "@/components/ui/atoms/TokenMark";
import { Typography } from "@/components/ui/atoms/Typography";
import { PillButton } from "@/components/ui/kit/PillButton";
import { BlurBackdrop } from "@/components/ui/molecules/BlurBackdrop";
import { useBalances } from "@/hooks/useBalances";
import { usePalette } from "@/hooks/usePalette";
import { useSwapTokens } from "@/hooks/useSwapTokens";
import { cn } from "@/utils/cn";
import {
  formatRawAmount,
  formatTokenPrice,
  type SwapToken,
  type SwapTokenCategory,
  type SwapTokenTrust,
} from "@/utils/swap";
import {
  heldSwapTokens,
  matchesTokenSearch,
  shortTokenAddress,
  type HeldSwapToken,
} from "@/utils/swapTokens";
import { pickSwapToken, useSwapPair, type SwapSide } from "@/utils/swapPair";
import { localIconForMint } from "@/utils/tokens";

interface Row {
  token: SwapToken;
  /** What the Account holds of it, in display units; absent when nothing. */
  balance?: string;
  usdPrice: number | null;
  /** Absent for a holding nothing has vouched for or warned about. */
  trust?: SwapTokenTrust;
}

/** `null` is the everyday list: the Consumer's own tokens and the popular ones. */
const SHELVES: { category: SwapTokenCategory | null; label: string }[] = [
  { category: null, label: "All" },
  { category: "crypto", label: "Crypto" },
  { category: "stocks", label: "Stocks" },
  { category: "meme", label: "Memes" },
];

/** The search field and the space around it, which the list has to clear. */
const SEARCH_HEIGHT = 84;

/**
 * Chooses the asset on one side of a swap, in a sheet over the Swap screen
 * that is pulled down to put away.
 *
 * Paying can only be done with something held, so that side lists holdings
 * and nothing else. Receiving adds the assets Swap offers, sorted onto
 * shelves so that tokenized stocks and meme tokens are a deliberate tap away
 * instead of sitting beside SOL.
 *
 * Anyone can mint a token under any name, so each row says how far its name
 * can be relied on: a tick for a verified token, a warning for one wearing a
 * verified token's ticker, and nothing for the rest.
 */
export const TokenPickerSheet = forwardRef<
  BottomSheetModal,
  { side: SwapSide }
>(({ side }, ref) => {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const pair = useSwapPair();
  const { tokens: balances } = useBalances();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<SwapTokenCategory | null>(null);
  // Nearly the whole screen: a list this long wants the room, and one height
  // means the sheet is either open or gone, never stranded half way.
  const snapPoints = useMemo(() => ["92%"], []);

  const receiving = side === "receive";
  const searching = search.trim().length > 0;
  const offered = useSwapTokens(receiving ? search : "", category);
  const held = useMemo(() => heldSwapTokens(balances), [balances]);

  const sections = useMemo(() => {
    const trusted = new Map(
      offered.tokens.map((token) => [token.mint, token.trust])
    );
    const ownRow = (token: HeldSwapToken): Row => ({
      token,
      balance: formatRawAmount(token.amountRaw, token.decimals),
      usdPrice: token.usdPrice,
      // The assets this app ships a logo for are ones it vouches for itself.
      trust:
        trusted.get(token.mint) ??
        (localIconForMint(token.mint) ? "verified" : undefined),
    });
    const mine = held
      .filter((token) => matchesTokenSearch(token, search))
      .map(ownRow);
    if (!receiving) return [{ title: "", data: mine }];

    const holdings = new Map(held.map((token) => [token.mint, token]));
    const listed: Row[] = offered.tokens.map((token) => {
      const own = holdings.get(token.mint);
      return own
        ? ownRow(own)
        : { token, usdPrice: token.usdPrice, trust: token.trust };
    });
    // A shelf is one list. A token the Consumer holds stays in its place on
    // it, with its balance, so the shelf reads the same for everyone.
    if (category && !searching) return [{ title: "", data: listed }];

    const others = listed.filter((row) => !holdings.has(row.token.mint));
    return [
      { title: "Your tokens", data: mine },
      { title: searching ? "Results" : "Popular", data: others },
    ].filter((section) => section.data.length > 0);
  }, [held, offered.tokens, search, searching, receiving, category]);

  const close = () => {
    if (ref && typeof ref !== "function") ref.current?.dismiss();
  };
  const pick = (token: SwapToken) => {
    pickSwapToken(side, token);
    close();
  };

  const waiting = receiving && (offered.isLoading || offered.isStale);
  const empty = sections.every((section) => section.data.length === 0);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => <BlurBackdrop {...props} />,
    []
  );

  // In the sheet's footer so that it rides above the keyboard with the sheet,
  // and on a solid ground of its own so the rows end above it instead of
  // showing through.
  const renderFooter = useCallback(
    (props: BottomSheetFooterProps) => (
      <BottomSheetFooter {...props}>
        <View
          className="bg-card px-5 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          <View className="flex-row items-center gap-4 rounded-3xl bg-foreground/[0.04] px-5 py-4">
            <BottomSheetTextInput
              value={search}
              onChangeText={setSearch}
              placeholder={receiving ? "Search tokens" : "Search your tokens"}
              placeholderTextColor={palette.fg(0.3)}
              keyboardAppearance={palette.dark ? "dark" : "light"}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search tokens"
              className="flex-1 py-0 text-[15px] text-foreground"
            />
            {search ? (
              <HapticPressable
                onPress={() => setSearch("")}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                hitSlop={8}
              >
                <Typography
                  weight="600"
                  className="text-[15px] text-foreground"
                >
                  Clear
                </Typography>
              </HapticPressable>
            ) : null}
          </View>
        </View>
      </BottomSheetFooter>
    ),
    [insets.bottom, palette, receiving, search]
  );

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      footerComponent={renderFooter}
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      onDismiss={() => {
        setSearch("");
        setCategory(null);
      }}
      backgroundStyle={{ backgroundColor: palette.card }}
      handleIndicatorStyle={
        palette.dark ? { backgroundColor: palette.fg(0.75) } : undefined
      }
    >
      <View className="flex-1">
        <View className="items-center pb-1 pt-1">
          <Typography variant="title1" weight="600">
            {receiving ? "You receive" : "You pay"}
          </Typography>
        </View>

        {receiving ? (
          // Its own band, with room beneath: the list starts clear of the
          // chips and scrolls away under their edge, not into them.
          <View className="pb-3 pt-4">
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
                      "h-10 items-center justify-center rounded-full px-4",
                      selected ? "bg-foreground" : "bg-foreground/[0.06]",
                      searching && "opacity-40"
                    )}
                  >
                    <Typography
                      weight="600"
                      className={cn(
                        "text-[15px]",
                        selected ? "text-background" : "text-foreground"
                      )}
                    >
                      {shelf.label}
                    </Typography>
                  </HapticPressable>
                );
              })}
            </ScrollView>
          </View>
        ) : (
          <View className="h-3" />
        )}

        {receiving && offered.failed && empty ? (
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
          <BottomSheetSectionList
            sections={sections}
            keyExtractor={(row: Row) => row.token.mint}
            renderSectionHeader={({
              section,
            }: {
              section: { title: string };
            }) =>
              section.title ? (
                <View className="px-5 pb-1 pt-3">
                  <Typography
                    weight="500"
                    className="text-[13px] text-foreground/55"
                  >
                    {section.title}
                  </Typography>
                </View>
              ) : null
            }
            renderItem={({ item }: { item: Row }) => (
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
            contentContainerStyle={{
              paddingBottom: SEARCH_HEIGHT + Math.max(insets.bottom, 12),
            }}
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
    </BottomSheetModal>
  );
});

TokenPickerSheet.displayName = "TokenPickerSheet";

const TRUST_LABEL: Record<SwapTokenTrust, string | null> = {
  verified: "verified",
  caution: "use caution, this may be a copy of another token",
  unverified: "not verified",
};

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
  const { token, balance, usdPrice, trust } = row;
  const detail = balance ? `${balance} ${token.symbol}` : token.symbol;
  const price = usdPrice === null ? null : formatTokenPrice(usdPrice);
  // A token nothing vouches for can share its name, ticker and logo with the
  // real one. Its address is the one thing it cannot copy.
  const address =
    trust === "unverified" || trust === "caution"
      ? shortTokenAddress(token.mint)
      : null;

  return (
    <HapticPressable
      onPress={onPress}
      feedback="selection"
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={[
        token.name,
        trust ? TRUST_LABEL[trust] : null,
        detail,
        price,
        address ? `address ${address}` : null,
      ]
        .filter(Boolean)
        .join(", ")}
      className={cn(
        "mx-2 h-[68px] flex-row items-center gap-3 rounded-2xl px-3",
        selected && "bg-foreground/[0.05]"
      )}
    >
      <TokenMark
        mint={token.mint}
        label={token.symbol}
        iconUrl={token.iconUrl}
        size={44}
      />
      <View className="flex-1">
        <View className="flex-row items-center gap-1">
          <Typography
            weight="600"
            numberOfLines={1}
            className="shrink text-[17px] text-foreground"
          >
            {token.name}
          </Typography>
          {trust === "verified" ? (
            <MaterialCommunityIcons
              name="check-decagram"
              size={17}
              color={palette.fg(0.55)}
            />
          ) : trust === "caution" ? (
            <FontAwesome6
              name="triangle-exclamation"
              size={14}
              color={palette.warning}
            />
          ) : null}
        </View>
        <Typography
          weight="500"
          numberOfLines={1}
          className="text-[14px] text-foreground/40"
        >
          {detail}
        </Typography>
      </View>
      <View className="items-end">
        {price ? (
          <Typography weight="600" className="text-[16px] text-foreground">
            {price}
          </Typography>
        ) : null}
        {address ? (
          <Typography weight="500" className="text-[14px] text-foreground/40">
            {address}
          </Typography>
        ) : null}
      </View>
    </HapticPressable>
  );
}
