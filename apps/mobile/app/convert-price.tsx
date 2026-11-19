import React, { useMemo, useState } from "react";
import {
  FlatList,
  InputAccessoryView,
  Keyboard,
  Modal,
  Platform,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
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
  deviceDecimalSeparator,
  finishTypedPrice,
  parseTypedPrice,
  startingPrice,
} from "@/utils/displayRates";
import { cn } from "@/utils/cn";
import { currencyFlagUrl, currencyName } from "@/utils/currencies";

const INK = "#0E0F0C";
const DONE_BAR = "convert-price-done";
const DISPLAY = { fontFamily: "Montserrat_900Black" } as const;

/** A currency's round flag, or a globe where no one country fits. */
function CurrencyFlag({ code, size }: { code: string; size: number }) {
  const uri = currencyFlagUrl(code);
  // A flag that will not load (offline, not served yet) falls back to the
  // globe rather than leaving an empty ring.
  const [failed, setFailed] = useState(false);
  if (uri && !failed) {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="overflow-hidden rounded-full border border-black/[0.08] bg-black/[0.06]"
        style={{ width: size, height: size }}
      >
        <Image
          source={{ uri }}
          style={{ width: "100%", height: "100%" }}
          cachePolicy="disk"
          transition={120}
          onError={() => setFailed(true)}
        />
      </View>
    );
  }
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="items-center justify-center rounded-full bg-black/[0.06]"
      style={{ width: size, height: size }}
    >
      <Ionicons name="globe-outline" size={size * 0.6} color={INK} />
    </View>
  );
}

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
  // Rates arrived but name no currency besides the dollar: nothing to convert.
  if (!from) {
    return (
      <ErrorState
        message="Rates are not available right now. Try again in a moment."
        onRetry={() => void rates.refetch()}
        onClose={() =>
          router.canGoBack() ? router.back() : router.replace("/(tabs)")
        }
      />
    );
  }
  const rate = perUsd[from];
  const shown = typed ?? startingPrice(rate);
  const price = parseTypedPrice(shown);
  const usd = Number.isFinite(price) && rate ? price / rate : 0;

  return (
    <FeatureScreen>
      <Typography weight="500" className="mt-4 text-[14px] text-black/60">
        It costs
      </Typography>
      <View className="mt-2 flex-row items-center justify-between gap-4">
        <CurrencyChip code={from} onPress={() => setPicking(true)} />
        <TextInput
          value={shown}
          onChangeText={(text) => {
            const next = text.replace(/[^0-9.,]/g, "");
            // A second decimal mark is a slip, not a new price: ignore it.
            // A lone mark is fine mid-typing: ".50" starts with it.
            if (next.split(deviceDecimalSeparator()).length <= 2) {
              setTyped(next);
            }
          }}
          onBlur={() =>
            setTyped((value) =>
              value === null ? value : finishTypedPrice(value)
            )
          }
          keyboardType="decimal-pad"
          // The decimal pad has no return key, so iOS gets a Done bar above it.
          inputAccessoryViewID={DONE_BAR}
          selectTextOnFocus
          accessibilityLabel={`Price in ${from}`}
          className="flex-1 text-right text-[52px] text-[#0E0F0C]"
          style={DISPLAY}
        />
      </View>

      <Typography weight="500" className="mt-7 text-[14px] text-black/60">
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
          <Typography weight="600" className="text-[15px] text-[#0E0F0C]">
            Exchange rate
          </Typography>
          <Typography weight="600" className="text-[15px] text-[#0E0F0C]">
            {formatCodeRate(from, rate)}
          </Typography>
        </View>
        <Typography weight="500" className="mt-1.5 text-[12px] text-black/45">
          {"Today's reference rate."}
        </Typography>
      </View>

      {Platform.OS === "ios" ? (
        <InputAccessoryView nativeID={DONE_BAR}>
          <View className="flex-row justify-end border-t border-black/[0.08] bg-[#F7F7F7] px-4 py-2">
            <HapticPressable
              accessibilityRole="button"
              accessibilityLabel="Done"
              onPress={() => Keyboard.dismiss()}
              className="rounded-full px-4 py-2"
            >
              <Typography weight="600" className="text-[16px] text-[#0E0F0C]">
                Done
              </Typography>
            </HapticPressable>
          </View>
        </InputAccessoryView>
      ) : null}

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
      className="flex-row items-center gap-2 rounded-full bg-black/[0.05] py-2 pl-2 pr-3.5"
    >
      <CurrencyFlag code={code} size={26} />
      <Typography weight="600" className="text-[15px] text-[#0E0F0C]">
        {code}
      </Typography>
      {onPress ? <Ionicons name="chevron-down" size={16} color={INK} /> : null}
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
          <Typography weight="700" className="text-[18px] text-[#0E0F0C]">
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
              accessibilityLabel={`${currencyName(item)}, ${item}`}
              className="flex-row items-center gap-3.5 py-3"
            >
              <CurrencyFlag code={item} size={36} />
              <View className="flex-1">
                <Typography weight="600" className="text-[15px] text-[#0E0F0C]">
                  {currencyName(item)}
                </Typography>
                <Typography weight="500" className="text-[13px] text-black/50">
                  {item}
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
