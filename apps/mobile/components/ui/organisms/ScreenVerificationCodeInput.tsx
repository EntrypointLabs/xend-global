import React, { useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { useScreenTheme } from "@/contexts/ScreenThemeContext";

interface ScreenVerificationCodeInputProps {
  onCodeComplete: (code: string) => void;
}

export function ScreenVerificationCodeInput({
  onCodeComplete,
}: ScreenVerificationCodeInputProps) {
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const { textColor, backgroundColor } = useScreenTheme();

  const isBackgroundDark =
    backgroundColor === "#000000" || backgroundColor.toLowerCase() === "#000";
  const inputBackgroundColor = isBackgroundDark ? "#FFFFFF" : "#000000";

  const handleChange = (text: string, index: number) => {
    if (text.length > 1) {
      const digits = text.split("").slice(0, 6);
      if (digits.length === 6 && digits.every((d) => /^\d$/.test(d))) {
        digits.forEach((digit, i) => {
          setTimeout(() => {
            const newCode = [...code];
            newCode[i] = digit;
            setCode(newCode);

            if (i < 5) {
              inputRefs.current[i + 1]?.focus();
            }

            if (i === 5) {
              onCodeComplete(digits.join(""));
            }
          }, i * 50);
        });
        return;
      }
    }

    const newCode = [...code];
    newCode[index] = text;
    setCode(newCode);

    if (text && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    if (newCode.every((digit) => digit !== "") && index === 5) {
      onCodeComplete(newCode.join(""));
    }
  };

  const handleKeyPress = (
    e: { nativeEvent: { key: string } },
    index: number
  ) => {
    if (e.nativeEvent.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  return (
    <View className="mb-4 flex-row justify-between">
      {code.map((digit, index) => (
        <TextInput
          key={index}
          ref={(ref) => {
            inputRefs.current[index] = ref;
          }}
          value={digit}
          onChangeText={(text) => handleChange(text, index)}
          onKeyPress={(e) => handleKeyPress(e, index)}
          keyboardType="number-pad"
          maxLength={6}
          className="h-[45px] w-[45px] rounded-xl border text-center text-xl font-semibold"
          // DYNAMIC-COLOR (theme-derived colors via ScreenThemeContext)
          style={{
            backgroundColor: inputBackgroundColor + "40",
            borderColor: textColor + "20",
            color: textColor,
          }}
          textAlign="center"
        />
      ))}
    </View>
  );
}
