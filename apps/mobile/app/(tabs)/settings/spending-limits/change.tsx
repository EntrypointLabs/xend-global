import React, { useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { router } from "expo-router";

import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Footnote, PillButton } from "@/components/ui/kit";
import { FeatureScreen } from "@/components/ui/feature/FeatureScreen";
import {
  describeChangeError,
  OnItsWay,
  useWaitingChange,
} from "@/components/ui/organisms/spending-limit/parts";
import { useAccount } from "@/hooks/useAccount";
import { useSpendingLimitChange } from "@/hooks/useSpendingLimitChange";
import type { SpendingLimit } from "@/utils/apiClient";
import {
  formatUsdcRaw,
  groupThousands,
  LIMIT_PERIOD_WORDS,
  MAX_LIMIT_RAW,
  toUsdcRaw,
} from "@/utils/spendingLimit";
import { cn } from "@/utils/cn";

const DISPLAY = { fontFamily: "Montserrat_900Black" } as const;
const PRESETS = [100, 250, 500, 1_000, 2_500, 5_000];

const HEADLINE: Record<SpendingLimit["period"], string> = {
  OneTime: "New amount",
  Daily: "New daily amount",
  Weekly: "New weekly amount",
  Monthly: "New monthly amount",
};

/**
 * Setting a new Quick pay amount, a first one, or none. Turning it off is one of
 * the choices rather than a button of its own, because it is the rarest thing
 * done here and it makes the Account stricter, not looser.
 */
export default function ChangeSpendingLimitScreen() {
  const { data: account } = useAccount();
  const { waiting } = useWaitingChange();
  const change = useSpendingLimitChange();
  const input = useRef<TextInput>(null);

  const [typed, setTyped] = useState("");
  const [noLimit, setNoLimit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<{
    waitingUntil: string | null;
    removed: boolean;
  } | null>(null);

  const limit = account?.spendingLimit;
  // A limit set from here refills daily, which is what provisioning writes and
  // what an Account without one would get back.
  const period = limit?.period ?? "Daily";
  const per = LIMIT_PERIOD_WORDS[period];
  const raw = toUsdcRaw(typed);
  const issue = noLimit
    ? null
    : amountIssue(typed, limit?.maxPerPeriod ?? null);
  const presets = PRESETS.filter(
    (whole) => toUsdcRaw(String(whole))?.toString() !== limit?.maxPerPeriod
  ).slice(0, 4);

  if (staged) {
    return (
      <OnItsWay
        amount={raw !== null ? `${formatUsdcRaw(raw.toString())} ${per}` : null}
        removed={staged.removed}
        waitingUntil={staged.waitingUntil}
        onDone={() =>
          router.canGoBack()
            ? router.back()
            : router.replace("/settings/spending-limits" as never)
        }
      />
    );
  }

  const save = async () => {
    if (!account) return;
    if (!noLimit && (raw === null || issue)) return;
    setError(null);
    try {
      const outcome = await change.mutateAsync({
        account,
        request: noLimit
          ? { remove: true }
          : { maxPerPeriod: (raw as bigint).toString() },
      });
      setStaged({ waitingUntil: outcome.waitingUntil, removed: noLimit });
    } catch (err) {
      setError(describeChangeError(err));
    }
  };

  const shown = display(typed);
  const size = amountSize(shown.length);
  const canSave =
    !!account &&
    limit !== undefined &&
    (noLimit ? !!limit : raw !== null && !issue) &&
    !waiting &&
    !change.isPending;

  return (
    <FeatureScreen
      avoidKeyboard
      footer={
        <View className="gap-3">
          {error ? (
            <Footnote tone="error" className="text-center">
              {error}
            </Footnote>
          ) : null}
          <PillButton
            title={
              change.isPending
                ? "Confirming it is you"
                : noLimit
                  ? "Turn off Quick pay"
                  : "Save amount"
            }
            disabled={!canSave}
            loading={change.isPending}
            onPress={() => void save()}
          />
        </View>
      }
    >
      <Typography
        accessibilityRole="header"
        className="text-[30px] uppercase leading-[32px] tracking-[-1px] text-ink"
        style={DISPLAY}
      >
        {limit === null ? "Turn on Quick pay" : HEADLINE[period]}
      </Typography>

      <Typography weight="500" className="mt-7 text-[14px] text-foreground/60">
        {limit
          ? `Now ${formatUsdcRaw(limit.maxPerPeriod)} ${per}`
          : "Quick pay is off now"}
      </Typography>
      <HapticPressable
        feedback="none"
        accessible={false}
        onPress={() => {
          setNoLimit(false);
          input.current?.focus();
        }}
        className="mt-1 flex-row items-center"
      >
        {noLimit ? (
          <Typography
            className="h-[72px] text-[52px] leading-[72px] tracking-[-1px] text-ink"
            style={DISPLAY}
          >
            Off
          </Typography>
        ) : (
          <>
            <Typography
              className={cn(
                size.text,
                typed ? "text-ink" : "text-foreground/20"
              )}
              style={DISPLAY}
            >
              $
            </Typography>
            <View className="ml-1 h-[72px] flex-1 justify-center">
              {/* iOS draws a native placeholder this large with a clipped top, so
              the empty state is drawn here in the same type as the $. */}
              {typed ? null : (
                <Typography
                  pointerEvents="none"
                  className="absolute left-0 text-[52px] leading-[60px] text-foreground/20"
                  style={DISPLAY}
                >
                  0
                </Typography>
              )}
              <TextInput
                ref={input}
                autoFocus
                value={shown}
                onChangeText={(text) => {
                  setError(null);
                  setTyped(clean(text));
                }}
                editable={!change.isPending && !waiting}
                keyboardType="decimal-pad"
                inputMode="decimal"
                accessibilityLabel={`New Quick pay amount, ${per}`}
                className={cn("h-[72px] py-0 text-ink", size.input)}
                style={DISPLAY}
              />
            </View>
          </>
        )}
      </HapticPressable>

      <View className="mt-3 flex-row flex-wrap gap-2">
        {presets.map((whole) => {
          const on = !noLimit && typed === String(whole);
          return (
            <HapticPressable
              key={whole}
              accessibilityRole="button"
              accessibilityLabel={`Set ${formatUsdcRaw(String(whole * 1_000_000))} ${per}`}
              accessibilityState={{ selected: on }}
              disabled={change.isPending || !!waiting}
              onPress={() => {
                setError(null);
                setNoLimit(false);
                setTyped(String(whole));
              }}
              className={cn(
                "h-10 items-center justify-center rounded-full px-4",
                on ? "bg-primary" : "bg-foreground/[0.05]"
              )}
            >
              <Typography
                weight="600"
                className={cn(
                  "text-[14px]",
                  on ? "text-primary-foreground" : "text-ink"
                )}
              >
                ${groupThousands(String(whole))}
              </Typography>
            </HapticPressable>
          );
        })}
        {limit ? (
          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel="Turn off Quick pay"
            accessibilityState={{ selected: noLimit }}
            disabled={change.isPending || !!waiting}
            onPress={() => {
              setError(null);
              setTyped("");
              setNoLimit(true);
              input.current?.blur();
            }}
            className={cn(
              "h-10 items-center justify-center rounded-full px-4",
              noLimit ? "bg-primary" : "bg-foreground/[0.05]"
            )}
          >
            <Typography
              weight="600"
              className={cn(
                "text-[14px]",
                noLimit ? "text-primary-foreground" : "text-ink"
              )}
            >
              Turn off
            </Typography>
          </HapticPressable>
        ) : null}
      </View>

      {issue ? (
        <Footnote tone="error" className="mt-4">
          {issue}
        </Footnote>
      ) : null}
      <Footnote className="mt-4">
        {waiting
          ? `${waiting.title}. ${waiting.body}`
          : noLimit
            ? "Every payment will ask you to confirm it is you twice. You will confirm it is you now, then Quick pay switches off in 24 hours."
            : limit
              ? `You will confirm it is you, then the new amount starts in 24 hours. The wait gives you time to stop it if it was not you. Until then, ${formatUsdcRaw(limit.maxPerPeriod)} ${per} still applies.`
              : "You will confirm it is you, then Quick pay starts in 24 hours. The wait gives you time to stop it if it was not you."}
      </Footnote>
    </FeatureScreen>
  );
}

/** Digits and one point, two places after it at most. */
function clean(text: string): string {
  const bare = text.replace(/[^\d.]/g, "");
  const [whole = "", ...rest] = bare.split(".");
  const digits = whole.replace(/^0+(?=\d)/, "").slice(0, 12);
  if (rest.length === 0) return digits;
  return `${digits || "0"}.${rest.join("").slice(0, 2)}`;
}

function display(typed: string): string {
  const [whole, fraction] = typed.split(".");
  const grouped = groupThousands(whole);
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** Steps the display type down so a long amount stays on one line. */
function amountSize(chars: number) {
  if (chars > 9)
    return { text: "text-[34px] leading-[40px]", input: "text-[34px]" };
  if (chars > 6)
    return { text: "text-[42px] leading-[50px]", input: "text-[42px]" };
  return { text: "text-[52px] leading-[60px]", input: "text-[52px]" };
}

/**
 * What is wrong with what the Consumer typed, or null while there is nothing
 * to say.
 *
 * Every one of these is a refusal the backend would give back a step later,
 * after two biometric prompts, so they are answered here instead.
 */
function amountIssue(amount: string, current: string | null): string | null {
  if (amount.trim() === "") return null;
  const raw = toUsdcRaw(amount);
  if (raw === null) return "Enter an amount, like 50 or 12.50.";
  if (raw === 0n) return "Enter an amount above zero.";
  if (raw > MAX_LIMIT_RAW) return "That is more than Quick pay allows.";
  if (current !== null && raw.toString() === current) {
    return "That is the amount you have now.";
  }
  return null;
}
