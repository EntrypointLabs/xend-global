import React, { useEffect, useState } from "react";
import { TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { PillButton, Footnote } from "@/components/ui/kit";
import { FeatureScreen } from "@/components/ui/feature/FeatureScreen";
import { Illustration } from "@/components/ui/feature/Illustration";
import { ScreenVerificationCodeInput } from "@/components/ui/organisms";
import { useNow } from "@/hooks/useNow";
import { apiClient } from "@/utils/apiClient";
import { fiatErrorMessage, type Verification } from "@/utils/fiat";

const DISPLAY = { fontFamily: "Montserrat_900Black" } as const;
const RESEND_AFTER_MS = 60_000;

const DECLINED: Record<string, string> = {
  ID_NOT_VERIFIED:
    "We couldn't verify that BVN. Check the number and try again.",
  ATTEMPTS_EXCEEDED: "Too many wrong codes. Start again with your BVN.",
  ALREADY_LINKED:
    "This BVN is already linked to another Prydd account. Contact support if that's not right.",
};

type Step = "intro" | "bvn" | "code";

/**
 * Lifts the naira limit with one BVN check. The BVN goes to our partner and
 * is never stored; the partner sends a code to the phone on the BVN record.
 */
export default function VerifyIdentityScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["fiat", "verification"],
    queryFn: () => apiClient.verification(),
  });
  const consent = useQuery({
    queryKey: ["fiat", "verification", "consent"],
    queryFn: () => apiClient.verificationConsent(),
    staleTime: Infinity,
  });
  const [step, setStep] = useState<Step>("intro");
  const [bvn, setBvn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeSentAt, setCodeSentAt] = useState(0);
  const [result, setResult] = useState<Verification | null>(null);
  const now = useNow(1000);

  const current = result ?? status.data ?? null;
  const close = () =>
    router.canGoBack() ? router.back() : router.replace("/(tabs)");

  useEffect(() => {
    if (current?.status === "code_sent" && step === "intro" && !result) {
      setStep("code");
    }
  }, [current?.status, step, result]);

  const settle = (next: Verification) => {
    setResult(next);
    void queryClient.invalidateQueries({ queryKey: ["fiat"] });
  };

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(
        fiatErrorMessage(err) ?? "Something went wrong. Try again in a moment."
      );
    } finally {
      setBusy(false);
    }
  };

  const sendBvn = () =>
    run(async () => {
      if (!consent.data) throw new Error("consent not loaded");
      const next = await apiClient.startVerification(bvn, consent.data.version);
      if (next.status === "code_sent") {
        setResult(null);
        setCodeSentAt(Date.now());
        setStep("code");
      } else {
        settle(next);
      }
    });

  const confirm = (code: string) =>
    run(async () => settle(await apiClient.confirmVerification(code)));

  const resend = () =>
    run(async () => {
      await apiClient.resendVerificationCode();
      setCodeSentAt(Date.now());
    });

  if (current?.status === "verified") {
    return (
      <Result
        art="verify"
        title="You're verified"
        body="Your naira limit is lifted: no more ₦50,000 daily cap on deposits or bank sends."
        action={{ title: "Done", onPress: close }}
      />
    );
  }
  if (current?.status === "in_review") {
    return (
      <Result
        icon="hourglass-outline"
        tone="muted"
        title="We're checking your details"
        body="This usually takes a few hours. Open this page again to see when it's done."
        action={{ title: "Close", onPress: close }}
      />
    );
  }
  if (current?.status === "declined" && result) {
    return (
      <Result
        icon="alert-circle-outline"
        tone="muted"
        title="We couldn't verify you"
        body={
          DECLINED[current.declineCode ?? ""] ??
          "We couldn't verify that BVN. Check the number and try again."
        }
        action={{
          title: "Try again",
          onPress: () => {
            setResult(null);
            setBvn("");
            setStep("bvn");
          },
        }}
      />
    );
  }

  if (step === "intro") {
    return (
      <FeatureScreen
        leave="close"
        footer={
          <PillButton
            title="Agree and continue"
            disabled={!consent.data}
            loading={consent.isLoading}
            onPress={() => setStep("bvn")}
          />
        }
      >
        <View className="overflow-hidden rounded-[28px] bg-[#F2F2F0] px-6 pb-5 pt-7">
          <Typography
            accessibilityRole="header"
            className="max-w-[210px] text-[34px] uppercase leading-[34px] tracking-[-1px] text-[#0E0F0C]"
            style={DISPLAY}
          >
            Raise your limit
          </Typography>
          <Typography
            weight="500"
            className="mt-2 max-w-[200px] text-[14px] leading-[20px] text-black/55"
          >
            One BVN check, about a minute.
          </Typography>
          <View className="absolute -bottom-3 -right-3">
            <Illustration name="verify" size={150} />
          </View>
          <View className="h-16" />
        </View>
        <View className="mt-7 gap-6">
          <Benefit
            icon="trending-up-outline"
            title="Move more than ₦50,000 a day"
            body="Without it, naira deposits and bank sends stop at ₦50,000 in any 24 hours."
          />
          <Benefit
            icon="logo-whatsapp"
            title="Your BVN and one code"
            body="We send a code on WhatsApp to the phone number on your BVN."
          />
          <Benefit
            icon="shield-checkmark-outline"
            title="Your BVN is never stored"
            body="It goes straight to our partner, Paj, to confirm it's you."
          />
        </View>
        {consent.data ? (
          <View className="mt-7 rounded-[20px] bg-black/[0.03] p-4">
            <Typography
              weight="500"
              className="text-[12px] leading-[18px] text-black/60"
            >
              {consent.data.text}
            </Typography>
          </View>
        ) : consent.isError ? (
          <Footnote tone="error" className="mt-7">
            {"Verification isn't available right now. Try again later."}
          </Footnote>
        ) : null}
      </FeatureScreen>
    );
  }

  if (step === "bvn") {
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
              title="Send code"
              disabled={!/^\d{11}$/.test(bvn)}
              loading={busy}
              onPress={() => void sendBvn()}
            />
          </View>
        }
      >
        <Typography
          accessibilityRole="header"
          weight="700"
          className="mt-2 text-[28px] leading-[34px] tracking-[-0.6px] text-[#0E0F0C]"
        >
          Enter your BVN
        </Typography>
        <Typography
          weight="500"
          className="mt-2 text-[14px] leading-[20px] text-black/55"
        >
          {
            "11 digits. Dial *565*0# on the phone linked to your bank if you don't know it."
          }
        </Typography>
        <TextInput
          value={bvn}
          onChangeText={(text) => {
            setError(null);
            setBvn(text.replace(/\D/g, "").slice(0, 11));
          }}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="off"
          autoFocus
          secureTextEntry={false}
          placeholder="00000000000"
          placeholderTextColor="#00000026"
          accessibilityLabel="Bank Verification Number"
          className="mt-8 h-16 rounded-[20px] bg-black/[0.04] px-5 text-[24px] tabular-nums tracking-[3px] text-[#0E0F0C]"
        />
        <View className="mt-4 flex-row items-center gap-2">
          <Ionicons name="lock-closed-outline" size={14} color="#00000073" />
          <Typography weight="500" className="text-[12px] text-black/60">
            Sent securely to Paj. Prydd never stores it.
          </Typography>
        </View>
      </FeatureScreen>
    );
  }

  const wait = Math.max(0, codeSentAt + RESEND_AFTER_MS - now);
  return (
    <FeatureScreen
      avoidKeyboard
      footer={
        error ? (
          <Footnote tone="error" className="text-center">
            {error}
          </Footnote>
        ) : undefined
      }
    >
      <Typography
        accessibilityRole="header"
        weight="700"
        className="mt-2 text-[28px] leading-[34px] tracking-[-0.6px] text-[#0E0F0C]"
      >
        Check WhatsApp
      </Typography>
      <Typography
        weight="500"
        className="mt-2 text-[14px] leading-[20px] text-black/55"
      >
        We sent a code to the phone number on your BVN. It works for 10 minutes.
      </Typography>
      <View className="mt-8">
        <ScreenVerificationCodeInput
          tone="light"
          onCodeComplete={(code) => void confirm(code)}
        />
      </View>
      <View className="mt-6 items-center">
        {busy ? (
          <Typography weight="500" className="text-[14px] text-black/60">
            Checking…
          </Typography>
        ) : wait > 0 ? (
          <Typography
            weight="500"
            className="text-[14px] tabular-nums text-black/60"
          >
            {`Send a new code in ${Math.ceil(wait / 1000)}s`}
          </Typography>
        ) : (
          <HapticPressable
            accessibilityRole="button"
            onPress={() => void resend()}
            className="h-11 justify-center px-4"
          >
            <Typography weight="600" className="text-[14px] text-[#0E0F0C]">
              Send a new code
            </Typography>
          </HapticPressable>
        )}
      </View>
      <Footnote className="mt-6 text-center">
        {
          "No code? It goes to the number your bank has on your BVN. If that's an old number, update it at your bank."
        }
      </Footnote>
    </FeatureScreen>
  );
}

function Benefit({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View className="flex-row gap-3.5">
      <View className="size-10 items-center justify-center rounded-full border border-black/[0.1]">
        <Ionicons name={icon} size={19} color="#0E0F0C" />
      </View>
      <View className="flex-1">
        <Typography
          weight="600"
          className="text-[15px] leading-[20px] text-[#0E0F0C]"
        >
          {title}
        </Typography>
        <Typography
          weight="500"
          className="mt-0.5 text-[13px] leading-[18px] text-black/60"
        >
          {body}
        </Typography>
      </View>
    </View>
  );
}

function Result({
  icon,
  tone = "muted",
  art,
  title,
  body,
  action,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: "success" | "muted";
  art?: "verify";
  title: string;
  body: string;
  action: { title: string; onPress: () => void };
}) {
  return (
    <FeatureScreen
      leave="close"
      scroll={false}
      footer={<PillButton title={action.title} onPress={action.onPress} />}
    >
      <View className="flex-1 items-center justify-center pb-16">
        {art ? (
          <Illustration name={art} size={170} />
        ) : (
          <View
            className={
              tone === "success"
                ? "size-16 items-center justify-center rounded-full bg-success/15"
                : "size-16 items-center justify-center rounded-full bg-black/[0.05]"
            }
          >
            <Ionicons
              name={icon ?? "information-circle-outline"}
              size={32}
              color={tone === "success" ? "#16A34A" : "#0E0F0C"}
            />
          </View>
        )}
        <Typography
          accessibilityRole="header"
          weight="700"
          className="mt-6 text-center text-[26px] leading-[32px] tracking-[-0.5px] text-[#0E0F0C]"
        >
          {title}
        </Typography>
        <Typography
          weight="500"
          className="mt-2 max-w-[310px] text-center text-[14px] leading-[20px] text-black/55"
        >
          {body}
        </Typography>
      </View>
    </FeatureScreen>
  );
}
