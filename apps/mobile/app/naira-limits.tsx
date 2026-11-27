import React from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Typography } from "@/components/ui/atoms/Typography";
import { PillButton, Footnote } from "@/components/ui/kit";
import { FeatureScreen } from "@/components/ui/feature/FeatureScreen";
import { ErrorState } from "@/components/ui/feature/ErrorState";
import { Illustration } from "@/components/ui/feature/Illustration";
import { usePalette } from "@/hooks/usePalette";
import { apiClient } from "@/utils/apiClient";
import { displayMoney } from "@/utils/display-money";
import { nairaAllowanceLeft, type FiatLimits } from "@/utils/fiat";
import { cn } from "@/utils/cn";
import { analytics } from "@/utils/analytics";

const DISPLAY = { fontFamily: "Montserrat_900Black" } as const;

const naira = (minor: bigint | string) =>
  displayMoney("NGN", minor.toString()).replace(/\.00$/, "");

type Stage = "unverified" | "code_sent" | "in_review" | "verified";

/**
 * How much naira the Consumer can add and send, and how to move up. Adding
 * and sending are counted apart, each against the same cap over the last 24
 * hours. Verifying with BVN lifts the cap; the backend reports no figure for
 * the raised limit, so none is shown.
 */
export default function NairaLimitsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const limits = useQuery({
    queryKey: ["fiat", "limits"],
    queryFn: () => apiClient.fiatLimits(),
  });
  const status = useQuery({
    queryKey: ["fiat", "verification"],
    queryFn: async () => {
      const next = await apiClient.verification();
      // Reading the status can settle a pending review with the partner, which
      // the limits read made at the same moment would not have seen yet.
      if (next.status === "verified")
        void queryClient.invalidateQueries({ queryKey: ["fiat", "limits"] });
      return next;
    },
  });
  const close = () =>
    router.canGoBack() ? router.back() : router.replace("/(tabs)");

  if (limits.isError) {
    return (
      <ErrorState
        message="We could not load your naira limits. Check your connection and try again."
        onRetry={() => void limits.refetch()}
        onClose={close}
      />
    );
  }

  const stage: Stage | null = !limits.data
    ? null
    : limits.data.verified || status.data?.status === "verified"
      ? "verified"
      : status.data?.status === "in_review"
        ? "in_review"
        : status.data?.status === "code_sent"
          ? "code_sent"
          : "unverified";

  if (stage === "verified") {
    return (
      <FeatureScreen leave="close" scroll={false}>
        <Raised />
      </FeatureScreen>
    );
  }

  const footer =
    stage === "unverified" || stage === "code_sent" ? (
      <PillButton
        title={
          stage === "code_sent"
            ? "Finish verifying"
            : "Verify to raise your limits"
        }
        onPress={() => {
          analytics.track("feature_opened", {
            feature: "verify_identity",
            source: "naira_limits",
          });
          router.push("/verify-identity");
        }}
      />
    ) : null;

  return (
    <FeatureScreen leave="close" footer={footer}>
      <Hero />
      {limits.data && stage ? (
        <Meters limits={limits.data} inReview={stage === "in_review"} />
      ) : (
        <Loading />
      )}
    </FeatureScreen>
  );
}

function Loading() {
  const palette = usePalette();
  return (
    <View className="items-center py-12">
      <ActivityIndicator size="small" color={palette.fg(0.25)} />
    </View>
  );
}

function Hero() {
  return (
    <View className="overflow-hidden rounded-[28px] bg-muted px-6 pb-5 pt-7">
      <Typography
        accessibilityRole="header"
        className="max-w-[200px] text-[34px] uppercase leading-[34px] tracking-[-1px] text-ink"
        style={DISPLAY}
      >
        Naira limits
      </Typography>
      <Typography
        weight="500"
        className="mt-2 max-w-[190px] text-[14px] leading-[20px] text-foreground/55"
      >
        How much naira you can add and send each day.
      </Typography>
      <View className="absolute -bottom-3 -right-3">
        <Illustration name="verify" size={140} />
      </View>
      <View className="h-14" />
    </View>
  );
}

function Raised() {
  return (
    <View className="flex-1 items-center justify-center pb-16">
      <Illustration name="verify" size={170} />
      <Typography
        accessibilityRole="header"
        className="mt-8 text-center text-[34px] uppercase leading-[34px] tracking-[-1px] text-ink"
        style={DISPLAY}
      >
        Limits raised
      </Typography>
      <Typography
        weight="500"
        className="mt-3 max-w-[300px] text-center text-[15px] leading-[21px] text-foreground/60"
      >
        {"You're verified, so you can add and send much more naira each day."}
      </Typography>
    </View>
  );
}

function Meters({
  limits,
  inReview,
}: {
  limits: FiatLimits;
  inReview: boolean;
}) {
  const cap = BigInt(limits.limitMinor);
  return (
    <View className="mt-7 gap-7">
      <Meter
        label="Add naira"
        left={nairaAllowanceLeft(limits, "receive")}
        cap={cap}
      />
      <Meter
        label="Send to a bank"
        left={nairaAllowanceLeft(limits, "send")}
        cap={cap}
      />
      {inReview ? <InReview /> : null}
      <Footnote>
        Each counts the last 24 hours, so room comes back as the hours pass.
      </Footnote>
    </View>
  );
}

function Meter({
  label,
  left,
  cap,
}: {
  label: string;
  left: bigint;
  cap: bigint;
}) {
  const used = cap === 0n ? 100 : Number(((cap - left) * 1000n) / cap) / 10;
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${naira(left)} left of ${naira(cap)}`}
    >
      <Typography weight="500" className="text-[14px] text-foreground/55">
        {label}
      </Typography>
      <View className="mt-1 flex-row items-baseline">
        <Typography
          className="text-[32px] leading-[38px] tracking-[-0.8px] text-ink"
          style={DISPLAY}
        >
          {naira(left)}
        </Typography>
        <Typography
          weight="600"
          className="ml-2 text-[15px] text-foreground/55"
        >
          left of {naira(cap)}
        </Typography>
      </View>
      <View className="mt-3 h-2 overflow-hidden rounded-full bg-foreground/[0.06]">
        <View
          className={cn("h-full rounded-full bg-ink", used === 0 && "hidden")}
          // MEASURED-LAYOUT (share of the 24-hour cap already used)
          style={{ width: `${Math.max(used, 2)}%` }}
        />
      </View>
    </View>
  );
}

/** BVN sent off and waiting on the partner; there is nothing to tap. */
function InReview() {
  const palette = usePalette();
  return (
    <View className="flex-row gap-3 rounded-[24px] border border-foreground/[0.06] p-5">
      <Ionicons name="hourglass" size={20} color={palette.ink} />
      <View className="flex-1">
        <Typography
          weight="600"
          className="text-[15px] leading-[20px] text-ink"
        >
          {"We're checking your details"}
        </Typography>
        <Typography
          weight="500"
          className="mt-1 text-[13px] leading-[19px] text-foreground/50"
        >
          This usually takes a few hours. Your limits go up as soon as it is
          done.
        </Typography>
      </View>
    </View>
  );
}
