import React from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { FontAwesome6 } from "@expo/vector-icons";
import { Typography } from "@/components/ui/atoms/Typography";
import { BANK_LOGOS } from "@/utils/bankLogos";
import { shortBankName, type RampDetails } from "@/utils/ramp";

function initials(name: string): string {
  const words = shortBankName(name).split(/\s+/).filter(Boolean);
  return (
    words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)
  ).toUpperCase();
}

/**
 * The badge on a naira row: the recipient's bank logo for a send. A deposit's
 * payer bank is never reported, so it gets a plain bank.
 */
export function RampMark({
  ramp,
  size = 40,
}: {
  ramp: RampDetails;
  size?: number;
}) {
  const disc = { width: size, height: size };
  const logo = ramp.logoKey ? BANK_LOGOS[ramp.logoKey] : undefined;

  if (logo) {
    return (
      <View
        className="items-center justify-center overflow-hidden rounded-full border border-black/[0.06] bg-white"
        style={disc}
      >
        <Image
          source={logo}
          style={{ width: size * 0.8, height: size * 0.8 }}
          contentFit="contain"
        />
      </View>
    );
  }

  return (
    <View
      className="items-center justify-center rounded-full bg-[#F2F2F2]"
      style={disc}
    >
      {ramp.bankName ? (
        <Typography weight="700" style={{ fontSize: size * 0.32 }}>
          {initials(ramp.bankName)}
        </Typography>
      ) : (
        <FontAwesome6
          name="building-columns"
          size={size * 0.38}
          color="#0E0F0C"
        />
      )}
    </View>
  );
}
