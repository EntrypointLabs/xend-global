import React, { useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import { useScreenTheme } from "@/contexts/ScreenThemeContext";

interface ScreenVerificationCodeInputProps {
  length?: number;
  onCodeComplete: (code: string) => void;
}

/**
 * OTP entry backed by a single hidden TextInput with the boxes as a visual
 * overlay. Because there's only one real field, typing, backspace, paste, and
 * SMS autofill are all handled natively by the OS — no per-box focus juggling.
 */
export function ScreenVerificationCodeInput({
  length = 6,
  onCodeComplete,
}: ScreenVerificationCodeInputProps) {
  const [code, setCode] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const { textColor, backgroundColor } = useScreenTheme();

  const isBackgroundDark =
    backgroundColor === "#000000" || backgroundColor.toLowerCase() === "#000";
  const inputBackgroundColor = isBackgroundDark ? "#FFFFFF" : "#000000";

  const handleChange = (text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, length);
    setCode(digits);
    if (digits.length === length) {
      onCodeComplete(digits);
    }
  };

  return (
    <Pressable onPress={() => inputRef.current?.focus()} className="mb-6">
      <View className="flex-row justify-between">
        {Array.from({ length }).map((_, index) => {
          const digit = code[index] ?? "";
          // Highlight the box the next character lands in (or the last box once
          // full) so the caret position is obvious.
          const isActive =
            isFocused &&
            (index === code.length ||
              (code.length === length && index === length - 1));
          return (
            <View
              key={index}
              className="h-[45px] w-[45px] items-center justify-center rounded-xl"
              // DYNAMIC-COLOR (theme-derived via ScreenThemeContext)
              style={{
                backgroundColor: inputBackgroundColor + "40",
                borderColor: isActive ? textColor : textColor + "20",
                borderWidth: isActive ? 2 : 1,
              }}
            >
              <Typography
                weight="600"
                className="text-2xl"
                style={{ color: textColor }}
              >
                {digit}
              </Typography>
            </View>
          );
        })}
      </View>

      {/* The real field: an invisible layer over the boxes. All taps and the
          system keyboard (paste, backspace, SMS autofill) route through it. */}
      <TextInput
        ref={inputRef}
        value={code}
        onChangeText={handleChange}
        keyboardType="number-pad"
        maxLength={length}
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        autoFocus
        caretHidden
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        // MEASURED-LAYOUT (absoluteFill over the boxes)
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          opacity: 0,
        }}
      />
    </Pressable>
  );
}
