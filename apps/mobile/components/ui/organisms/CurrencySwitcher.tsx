import React, { useState } from "react";
import { View, TouchableOpacity, Image } from "react-native";
import { Typography } from "../atoms/Typography";
import { BlurView } from "expo-blur";
import tinycolor from "tinycolor2";
import { Currency } from "@/types/Transaction";
import { cn } from "@/utils/cn";

interface CurrencySwitcherProps {
  onCurrencyChange: (currency: Currency) => void;
  backgroundColor?: string;
  textColor?: string;
}

export function CurrencySwitcher({
  onCurrencyChange,
  backgroundColor = "white",
  textColor = "#000",
}: CurrencySwitcherProps) {
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>("usd");

  const selectedBackgroundColor = backgroundColor;
  const colorInstance = tinycolor(backgroundColor);
  // Slightly more opaque than the iOS design so the container still reads on
  // Android, where expo-blur renders no blur to reinforce it.
  const unselectedBackgroundColor = colorInstance.setAlpha(0.2).toRgbString();
  const unselectedTextColor = backgroundColor;

  const handleCurrencyChange = (currency: Currency) => {
    setSelectedCurrency(currency);
    onCurrencyChange(currency);
  };

  const usFlagIcon = require("@/assets/images/us-flag-round.png");
  const euFlagIcon = require("@/assets/images/eu-flag-round.png");

  const renderTab = (code: Currency, label: string, icon: number) => {
    const isSelected = selectedCurrency === code;
    return (
      <TouchableOpacity
        className="items-center justify-center rounded-[25px] px-5 py-2.5"
        // DYNAMIC-COLOR (caller-provided palette)
        style={{
          backgroundColor: isSelected ? selectedBackgroundColor : "transparent",
        }}
        onPress={() => handleCurrencyChange(code)}
      >
        <View className="flex-row items-center">
          <Image source={icon} className="mr-2 h-6 w-6 rounded-full" />
          <Typography
            weight="500"
            className={cn(!isSelected && "opacity-100")}
            // DYNAMIC-COLOR
            style={{ color: isSelected ? textColor : unselectedTextColor }}
          >
            {label}
          </Typography>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View className="items-center justify-center">
      <BlurView
        intensity={20}
        tint="dark"
        className="w-auto flex-row self-center overflow-hidden rounded-[25px]"
        // DYNAMIC-COLOR (alpha-derived from caller backgroundColor)
        style={{ backgroundColor: unselectedBackgroundColor }}
      >
        {renderTab("usd", "USD", usFlagIcon)}
        {renderTab("eur", "EUR", euFlagIcon)}
      </BlurView>
    </View>
  );
}
