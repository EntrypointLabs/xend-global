import React from "react";
import { View, type ImageSourcePropType } from "react-native";
import { Image } from "expo-image";
import { Typography } from "@/components/ui/atoms/Typography";
import { cn } from "@/utils/cn";

/** Keyed by the `logoKey` the payout bank list carries. */
const LOGOS: Record<string, ImageSourcePropType> = {
  "access-bank": require("@/assets/banks/access-bank.png"),
  carbon: require("@/assets/banks/carbon.png"),
  "coronation-bank": require("@/assets/banks/coronation-bank.png"),
  ecobank: require("@/assets/banks/ecobank.png"),
  eyowo: require("@/assets/banks/eyowo.png"),
  fcmb: require("@/assets/banks/fcmb.png"),
  "fidelity-bank": require("@/assets/banks/fidelity-bank.png"),
  "first-bank": require("@/assets/banks/first-bank.png"),
  "globus-bank": require("@/assets/banks/globus-bank.png"),
  gomoney: require("@/assets/banks/gomoney.png"),
  gtbank: require("@/assets/banks/gtbank.png"),
  "heritage-bank": require("@/assets/banks/heritage-bank.png"),
  "jaiz-bank": require("@/assets/banks/jaiz-bank.png"),
  "keystone-bank": require("@/assets/banks/keystone-bank.png"),
  kuda: require("@/assets/banks/kuda.png"),
  "momo-psb": require("@/assets/banks/momo-psb.png"),
  moniepoint: require("@/assets/banks/moniepoint.png"),
  opay: require("@/assets/banks/opay.png"),
  "optimus-bank": require("@/assets/banks/optimus-bank.png"),
  "parallex-bank": require("@/assets/banks/parallex-bank.png"),
  "polaris-bank": require("@/assets/banks/polaris-bank.png"),
  "premiumtrust-bank": require("@/assets/banks/premiumtrust-bank.png"),
  "providus-bank": require("@/assets/banks/providus-bank.png"),
  "rand-merchant-bank": require("@/assets/banks/rand-merchant-bank.png"),
  "smartcash-psb": require("@/assets/banks/smartcash-psb.png"),
  sparkle: require("@/assets/banks/sparkle.png"),
  "stanbic-ibtc": require("@/assets/banks/stanbic-ibtc.png"),
  "standard-chartered": require("@/assets/banks/standard-chartered.png"),
  "sterling-bank": require("@/assets/banks/sterling-bank.png"),
  "suntrust-bank": require("@/assets/banks/suntrust-bank.png"),
  "taj-bank": require("@/assets/banks/taj-bank.png"),
  uba: require("@/assets/banks/uba.png"),
  "union-bank": require("@/assets/banks/union-bank.png"),
  "unity-bank": require("@/assets/banks/unity-bank.png"),
  vfd: require("@/assets/banks/vfd.png"),
  "zenith-bank": require("@/assets/banks/zenith-bank.png"),
};

function monogram(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter((word) => /^[A-Za-z0-9]/.test(word));
  return (
    words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)
  ).toUpperCase();
}

export function BankLogo({
  name,
  logoKey,
  size = "md",
}: {
  name: string;
  logoKey?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const source = logoKey ? LOGOS[logoKey] : undefined;
  const lg = size === "lg";
  const sm = size === "sm";
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn(
        "items-center justify-center overflow-hidden rounded-full border border-foreground/[0.06]",
        lg ? "size-12" : sm ? "size-8" : "size-10",
        source ? "bg-white" : "bg-foreground/[0.05]"
      )}
    >
      {source ? (
        <Image
          source={source}
          style={{
            width: lg ? 40 : sm ? 26 : 32,
            height: lg ? 40 : sm ? 26 : 32,
          }}
          contentFit="contain"
        />
      ) : (
        <Typography
          weight="700"
          className={cn(
            "text-ink",
            lg ? "text-[16px]" : sm ? "text-[11px]" : "text-[13px]"
          )}
        >
          {monogram(name)}
        </Typography>
      )}
    </View>
  );
}
