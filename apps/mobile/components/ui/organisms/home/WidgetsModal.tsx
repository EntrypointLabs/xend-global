import React from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { TokenMark } from "@/components/ui/atoms/TokenMark";
import { Typography } from "@/components/ui/atoms/Typography";
import { ActionModal } from "@/components/ui/organisms/ActionModal";
import type { InvestmentHolding } from "@/hooks/useInvestments";
import type { WatchedToken } from "@/hooks/useWatchlist";
import { statusLabel, type ActivityEntry } from "@/utils/activity";
import { formatMoney } from "@/utils/balances";
import { cn } from "@/utils/cn";
import { getUsdcMint } from "@/utils/cluster";
import {
  HOME_WIDGETS,
  type HomeWidgetKey,
  type HomeWidgetVisibility,
} from "@/utils/homeWidgets";
import { formatAmount } from "@/utils/solana";
import type { MonthlySpend } from "@/utils/spentThisMonth";
import { SpendLine } from "./SpentThisMonth";

export interface WidgetPreviewData {
  holdings: InvestmentHolding[];
  latestEntry: ActivityEntry | null;
  spend: MonthlySpend;
  watched: WatchedToken[];
}

interface WidgetsModalProps {
  visible: boolean;
  onClose: () => void;
  visibility: HomeWidgetVisibility;
  onChange: (key: HomeWidgetKey, visible: boolean) => void;
  preview: WidgetPreviewData;
}

/** Share of the screen the grid may take before it scrolls. */
const GRID_MAX_SCREEN_SHARE = 0.58;
const MARK_SIZE = 44;
const MARK_OVERLAP = -8;
/** More logos than this run under the corner badge on a phone-width card. */
const MAX_MARKS = 2;

function Caption({ title, detail }: { title: string; detail: string }) {
  return (
    <View className="items-center">
      <Typography
        weight="600"
        className="text-center text-[15px] leading-5"
        numberOfLines={2}
      >
        {title}
      </Typography>
      <Typography
        weight="500"
        className="mt-0.5 text-center text-xs text-black/40"
        numberOfLines={1}
      >
        {detail}
      </Typography>
    </View>
  );
}

function AssetsPreview({ holdings }: { holdings: InvestmentHolding[] }) {
  const marks =
    holdings.length > 0
      ? holdings
          .slice(0, MAX_MARKS - 1)
          .map((h) => ({ mint: h.mint, label: h.name, iconUrl: h.iconUrl }))
      : [{ mint: getUsdcMint(), label: "USDC", iconUrl: null }];
  return (
    <>
      <View className="flex-row items-center">
        {marks.map((mark, index) => (
          <View
            key={mark.mint}
            style={{ marginLeft: index === 0 ? 0 : MARK_OVERLAP }}
          >
            <TokenMark
              mint={mark.mint}
              label={mark.label}
              iconUrl={mark.iconUrl}
              size={MARK_SIZE}
            />
          </View>
        ))}
        <View
          className="size-11 items-center justify-center rounded-full bg-black/10"
          style={{ marginLeft: MARK_OVERLAP }}
        >
          <Ionicons name="bar-chart-outline" size={20} color="#000" />
        </View>
      </View>
      <Caption title="Your assets" detail="Holdings and next steps" />
    </>
  );
}

function TransactionsPreview({ entry }: { entry: ActivityEntry | null }) {
  const detail = entry
    ? `${statusLabel(entry)} ${entry.direction === "send" ? "-" : "+"}${formatAmount(entry.amountRaw, entry.decimals)}`
    : "Latest money in and out";
  return (
    <>
      {entry ? (
        <TokenMark
          mint={entry.mint}
          label={entry.tokenName ?? entry.tokenSymbol ?? "?"}
          iconUrl={entry.iconUrl}
          size={MARK_SIZE}
        />
      ) : (
        <View className="size-11 items-center justify-center rounded-full bg-black/10">
          <Ionicons name="swap-vertical" size={20} color="#000" />
        </View>
      )}
      <Caption title="Recent transactions" detail={detail} />
    </>
  );
}

function SpendPreview({ spend }: { spend: MonthlySpend }) {
  return (
    <View className="w-full flex-1 justify-between pt-1">
      <View>
        <Typography weight="500" className="text-[13px] text-black/40">
          Spent this month
        </Typography>
        <Typography weight="700" className="text-2xl tracking-[-0.5px]">
          ${formatMoney(spend.totalUsd)}
        </Typography>
      </View>
      <SpendLine values={spend.cumulative} height={52} />
    </View>
  );
}

function WatchlistPreview({ tokens }: { tokens: WatchedToken[] }) {
  const first = tokens[0];
  const price =
    first && first.usdPrice !== null ? ` $${formatMoney(first.usdPrice)}` : "";
  return (
    <>
      <View className="flex-row items-center">
        {tokens.slice(0, MAX_MARKS).map((token, index) => (
          <View
            key={token.mint}
            style={{ marginLeft: index === 0 ? 0 : MARK_OVERLAP }}
          >
            <TokenMark
              mint={token.mint}
              label={token.name}
              iconUrl={token.iconUrl}
              size={MARK_SIZE}
            />
          </View>
        ))}
      </View>
      <Caption
        title="Watchlist"
        detail={first ? `${first.symbol}${price}` : "Popular tokens"}
      />
    </>
  );
}

function PreviewCard({
  title,
  on,
  onToggle,
  children,
}: {
  title: string;
  on: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <HapticPressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={title}
      onPress={onToggle}
      className="aspect-square w-[48.5%] rounded-[28px] bg-black/[0.05]"
    >
      <View
        className={cn(
          "absolute right-3 top-3 z-10 size-7 items-center justify-center rounded-full",
          on ? "bg-black" : "bg-black/10"
        )}
      >
        <Ionicons
          name={on ? "checkmark" : "add"}
          size={16}
          color={on ? "#FFF" : "#000"}
        />
      </View>
      <View
        className={cn(
          "flex-1 items-center justify-between px-3 pb-4 pt-5",
          !on && "opacity-50"
        )}
      >
        {children}
      </View>
    </HapticPressable>
  );
}

export function WidgetsModal({
  visible,
  onClose,
  visibility,
  onChange,
  preview,
}: WidgetsModalProps) {
  const { height } = useWindowDimensions();

  const previews: Record<HomeWidgetKey, React.ReactNode> = {
    assets: <AssetsPreview holdings={preview.holdings} />,
    transactions: <TransactionsPreview entry={preview.latestEntry} />,
    spend: <SpendPreview spend={preview.spend} />,
    watchlist: <WatchlistPreview tokens={preview.watched} />,
  };

  return (
    <ActionModal visible={visible} onClose={onClose}>
      <View className="mb-5 flex-col items-center justify-center">
        <View className="mb-5">
          <Ionicons name="grid-outline" size={30} color="#000" />
        </View>
        <Typography weight="600" className="mb-1 text-base">
          Home widgets
        </Typography>
        <Typography
          weight="500"
          className="max-w-[240px] text-center text-sm text-black/40"
        >
          Tap to add or remove a widget
        </Typography>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        // DYNAMIC-SIZE: the share of the screen the grid may take
        style={{ maxHeight: height * GRID_MAX_SCREEN_SHARE }}
      >
        <View className="flex-row flex-wrap justify-between gap-y-3">
          {HOME_WIDGETS.map(({ key, title }) => (
            <PreviewCard
              key={key}
              title={title}
              on={visibility[key]}
              onToggle={() => onChange(key, !visibility[key])}
            >
              {previews[key]}
            </PreviewCard>
          ))}
        </View>
      </ScrollView>
    </ActionModal>
  );
}
