import React from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";

import { Typography } from "@/components/ui/atoms/Typography";
import { PillButton } from "@/components/ui/kit";
import { FeatureScreen } from "@/components/ui/feature/FeatureScreen";
import { WaitingPill } from "@/components/ui/feature/FeatureIntro";
import { ErrorState } from "@/components/ui/feature/ErrorState";
import {
  LimitHero,
  PendingNote,
  useWaitingChange,
} from "@/components/ui/organisms/spending-limit/parts";
import { useAccount } from "@/hooks/useAccount";
import { usePalette } from "@/hooks/usePalette";
import {
  formatUsdcRaw,
  LIMIT_PERIOD_REMAINING,
  LIMIT_PERIOD_WORDS,
} from "@/utils/spendingLimit";
import { cn } from "@/utils/cn";

const DISPLAY = { fontFamily: "Montserrat_900Black" } as const;

// To Settings, not back. This screen is reachable from the home banner, and
// `back` from there returns to the home tab and strands the settings stack on
// a sub-screen.
const toSettings = () => router.navigate("/settings" as never);

/**
 * The Consumer's Spending Limit and what is left of it today.
 *
 * Neither change is instant. Changing or removing the limit is a settings
 * change like moving a key: both signers approve it and it waits a day before
 * it takes effect, and this screen says so rather than showing a saved state
 * that has not happened. A limit a single tap could raise would not be a
 * limit.
 */
export default function SpendingLimitsScreen() {
  const palette = usePalette();
  const { data: account, isLoading, refetch } = useAccount();
  const { waiting, reading } = useWaitingChange();

  if (!isLoading && !account) {
    return (
      <ErrorState
        message="We could not load Quick pay. Check your connection and try again."
        onRetry={() => void refetch()}
        onClose={toSettings}
      />
    );
  }

  // Absent is not the same answer as null. Null is an Account with no limit;
  // absent is a backend that did not report one, and showing that as "no
  // limit" would tell a Consumer something about their money that nobody
  // here knows.
  const limit = account?.spendingLimit;
  const ready = !!account && limit !== undefined && !reading;

  const footer = !ready ? null : waiting ? (
    <WaitingPill label={waiting.footer} informative />
  ) : (
    <PillButton
      title={limit ? "Change amount" : "Turn on Quick pay"}
      onPress={() => router.push("/settings/spending-limits/change" as never)}
    />
  );

  return (
    <FeatureScreen onBack={toSettings} footer={footer}>
      <LimitHero />

      {isLoading ? (
        <View className="items-center py-12">
          <ActivityIndicator size="small" color={palette.fg(0.25)} />
        </View>
      ) : limit === undefined ? (
        <View className="mt-7">
          <Typography weight="600" className="text-[17px] text-ink">
            Your Quick pay amount is not showing
          </Typography>
          <Typography
            weight="500"
            className="mt-1 text-[14px] leading-[20px] text-foreground/55"
          >
            Prydd cannot read it right now, so it cannot be changed. Your money
            is safe. Try again in a moment.
          </Typography>
        </View>
      ) : limit === null ? (
        <View className="mt-7">
          <Typography
            className="text-[44px] leading-[52px] tracking-[-1px] text-foreground/45"
            style={DISPLAY}
          >
            Off
          </Typography>
          <Typography
            weight="500"
            className="mt-2 text-[14px] leading-[20px] text-foreground/55"
          >
            Every payment asks you to confirm it is you twice. Turn on Quick pay
            and payments up to your amount need just one check.
          </Typography>
        </View>
      ) : (
        <View className="mt-7">
          <View className="flex-row items-baseline">
            <Typography
              accessibilityLabel={`${formatUsdcRaw(limit.maxPerPeriod)} ${LIMIT_PERIOD_WORDS[limit.period]}`}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              className="shrink text-[44px] leading-[52px] tracking-[-1px] text-ink"
              style={DISPLAY}
            >
              {formatUsdcRaw(limit.maxPerPeriod)}
            </Typography>
            <Typography
              weight="600"
              className="ml-2 text-[18px] text-foreground/45"
            >
              {LIMIT_PERIOD_WORDS[limit.period]}
            </Typography>
          </View>

          <UsedBar max={limit.maxPerPeriod} left={limit.remainingInPeriod} />
          <Typography
            weight="500"
            className="mt-2.5 text-[14px] tabular-nums text-foreground/60"
          >
            <Typography weight="600" className="text-[14px] text-ink">
              {formatUsdcRaw(limit.remainingInPeriod)}
            </Typography>{" "}
            {LIMIT_PERIOD_REMAINING[limit.period]}
          </Typography>
        </View>
      )}

      {waiting && limit !== undefined ? (
        <PendingNote title={waiting.title} body={waiting.body} />
      ) : null}
    </FeatureScreen>
  );
}

/**
 * How much of the period is spent, as a bar. Read off a counter that can lag
 * a refill, so it is never labelled as "spent today": only what is left is
 * stated, and that is the figure the program itself checks.
 */
function UsedBar({ max, left }: { max: string; left: string }) {
  const cap = BigInt(max);
  const remaining = BigInt(left);
  const used =
    cap === 0n || remaining >= cap
      ? 0
      : Number(((cap - remaining) * 1000n) / cap) / 10;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="mt-4 h-2 overflow-hidden rounded-full bg-foreground/[0.06]"
    >
      <View
        className={cn("h-full rounded-full bg-ink", used === 0 && "hidden")}
        // MEASURED-LAYOUT (share of the limit already used)
        style={{ width: `${Math.max(used, 2)}%` }}
      />
    </View>
  );
}
