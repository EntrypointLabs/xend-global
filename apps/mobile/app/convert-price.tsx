import React, { useMemo, useState } from "react";
import { FlatList, Modal, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { ErrorState } from "@/components/ui/feature/ErrorState";
import { FeatureScreen } from "@/components/ui/feature/FeatureScreen";
import { Illustration } from "@/components/ui/feature/Illustration";
import { useCountryCard } from "@/hooks/useCountryCard";
import { useDisplayRates } from "@/hooks/useDisplayRates";
import {
  formatCodeRate,
  formatCurrencyAmount,
  startingPrice,
} from "@/utils/displayRates";
import { cn } from "@/utils/cn";

const INK = "#0E0F0C";
const DISPLAY = { fontFamily: "Montserrat_900Black" } as const;

const currencyName = (() => {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "currency" });
    return (code: string) => names.of(code) ?? code;
  } catch {
    return (code: string) => code;
  }
})();

/**
 * What a price in front of you costs in dollars, at the rate the country card
 * shows. Opens on the card's own currency; any currency with a rate can be
 * picked.
 */
export default function ConvertPriceScreen() {
  const router = useRouter();
  const card = useCountryCard();
  const rates = useDisplayRates();
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const perUsd = rates.data?.perUsd;
  const codes = useMemo(
    () =>
      perUsd
        ? Object.keys(perUsd)
            .filter((code) => code !== "USD")
            .sort()
        : [],
    [perUsd]
  );

  if (!perUsd) {
    if (rates.isError) {
      return (
        <ErrorState
          message="We could not load today's rates. Check your connection and try again."
          onRetry={() => void rates.refetch()}
          onClose={() =>
            router.canGoBack() ? router.back() : router.replace("/(tabs)")
          }
        />
      );
    }
    return (
      <FeatureScreen scroll={false}>
        <View className="flex-1 items-center justify-center pb-24">
          <Illustration name="convert" size={200} />
          <Typography weight="500" className="mt-6 text-[16px] text-black/55">
            {"Getting today's rates"}
          </Typography>
        </View>
      </FeatureScreen>
    );
  }

  const fallback =
    card?.currency && card.currency !== "USD" && perUsd[card.currency]
      ? card.currency
      : (codes.find((code) => code === "GBP") ?? codes[0]);
  const from = picked ?? fallback;
  const rate = perUsd[from];
  const shown = typed ?? startingPrice(rate);
  const price = Number.parseFloat(shown.replace(/,/g, ""));
  const usd = Number.isFinite(price) && rate ? price / rate : 0;

  return (
    <FeatureScreen>
      <Typography weight="500" className="mt-4 text-[17px] text-black/70">
        It costs
      </Typography>
      <View className="mt-2 flex-row items-center justify-between gap-4">
        <CurrencyChip code={from} onPress={() => setPicking(true)} />
        <TextInput
          value={shown}
          onChangeText={(text) => setTyped(text.replace(/[^0-9.,]/g, ""))}
          keyboardType="decimal-pad"
          selectTextOnFocus
          accessibilityLabel={`Price in ${from}`}
          className="flex-1 text-right text-[52px] text-[#0E0F0C]"
          style={DISPLAY}
        />
      </View>

      <Typography weight="500" className="mt-8 text-[17px] text-black/70">
        You pay
      </Typography>
      <View className="mt-2 flex-row items-center justify-between gap-4">
        <CurrencyChip code="USD" />
        <Typography
          numberOfLines={1}
          adjustsFontSizeToFit
          accessibilityLabel={`${formatCurrencyAmount(usd, "USD")} US dollars`}
          className="flex-1 text-right text-[52px] text-[#0E0F0C]"
          style={DISPLAY}
        >
          {formatCurrencyAmount(usd, "USD")}
        </Typography>
      </View>

      <View className="mt-8 border-t border-black/[0.08] pt-6">
        <View className="flex-row items-center justify-between">
          <Typography weight="600" className="text-[17px] text-[#0E0F0C]">
            Exchange rate
          </Typography>
          <Typography weight="600" className="text-[17px] text-[#0E0F0C]">
            {formatCodeRate(from, rate)}
          </Typography>
        </View>
        <Typography weight="500" className="mt-2 text-[14px] text-black/45">
          {"Today's reference rate."}
        </Typography>
      </View>

      <CurrencyPicker
        visible={picking}
        codes={codes}
        current={from}
        onPick={(code) => {
          setPicked(code);
          setTyped(null);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </FeatureScreen>
  );
}

function CurrencyChip({
  code,
  onPress,
}: {
  code: string;
  onPress?: () => void;
}) {
  return (
    <HapticPressable
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={
        onPress ? `Change currency, now ${currencyName(code)}` : code
      }
      disabled={!onPress}
      onPress={onPress}
      className="flex-row items-center gap-2 rounded-full bg-black/[0.05] py-3 pl-4 pr-4"
    >
      <Typography weight="600" className="text-[18px] text-[#0E0F0C]">
        {code}
      </Typography>
      {onPress ? <Ionicons name="chevron-down" size={18} color={INK} /> : null}
    </HapticPressable>
  );
}

function CurrencyPicker({
  visible,
  codes,
  current,
  onPick,
  onClose,
}: {
  visible: boolean;
  codes: string[];
  current: string;
  onPick: (code: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-white px-5 pt-6">
        <View className="flex-row items-center justify-between">
          <Typography weight="700" className="text-[22px] text-[#0E0F0C]">
            Choose a currency
          </Typography>
          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            className="size-10 items-center justify-center rounded-full bg-black/[0.05]"
          >
            <Ionicons name="close" size={20} color={INK} />
          </HapticPressable>
        </View>
        <FlatList
          className="mt-4"
          data={codes}
          keyExtractor={(code) => code}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          renderItem={({ item }) => (
            <HapticPressable
              accessibilityRole="button"
              accessibilityState={{ selected: item === current }}
              onPress={() => onPick(item)}
              className="flex-row items-center justify-between py-4"
            >
              <View>
                <Typography weight="600" className="text-[17px] text-[#0E0F0C]">
                  {item}
                </Typography>
                <Typography weight="500" className="text-[14px] text-black/50">
                  {currencyName(item)}
                </Typography>
              </View>
              <Ionicons
                name="checkmark"
                size={20}
                color={INK}
                className={cn(item !== current && "opacity-0")}
              />
            </HapticPressable>
          )}
        />
      </View>
    </Modal>
  );
}
