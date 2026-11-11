import React, { forwardRef } from "react";
import {
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
  StyleProp,
} from "react-native";
import { useScreenTheme } from "@/contexts/ScreenThemeContext";
import { CircleButton } from "./CircleButton";

interface ThemedTextInputProps extends Omit<TextInputProps, "style"> {
  onButtonPress?: () => void;
  buttonIcon?: keyof typeof import("@expo/vector-icons").Ionicons.glyphMap;
  buttonDisabled?: boolean;
  buttonSize?: number;
  withButtonBackground?: boolean;
  style?: StyleProp<ViewStyle>;
  inputStyle?: TextInputProps["style"];
  error?: boolean;
}

function isDarkCanvas(backgroundColor: string) {
  const hex = backgroundColor.trim().toLowerCase();
  return hex === "#000" || hex === "#000000" || hex === "black";
}

/** Matches auth primary CTA pills (`h-14` / `p-4` ≈ 56pt). */
export const THEMED_TEXT_INPUT_HEIGHT = 56;

export const ThemedTextInput = forwardRef<TextInput, ThemedTextInputProps>(
  (
    {
      style,
      inputStyle,
      onButtonPress,
      buttonIcon,
      buttonDisabled = false,
      buttonSize = 40,
      withButtonBackground = true,
      error,
      keyboardAppearance,
      selectionColor,
      cursorColor,
      underlineColorAndroid,
      ...textInputProps
    },
    ref
  ) => {
    const { textColor, backgroundColor } = useScreenTheme();

    const dark = isDarkCanvas(backgroundColor);
    const buttonBackground = dark ? "#FFFFFF" : "#000000";
    const iconColor = dark ? "#000000" : "#FFFFFF";

    const errorColor = "#FF3B30";
    // Fill and border use different alphas so the pill does not read as a
    // double stroke against a dark canvas.
    const fieldFill = dark ? "rgba(255,255,255,0.08)" : textColor + "14";
    const fieldBorder = error
      ? errorColor
      : dark
        ? "rgba(255,255,255,0.18)"
        : textColor + "28";

    return (
      <View
        className="w-full flex-row items-center rounded-full px-5"
        // DYNAMIC-COLOR (per-screen theme via useScreenTheme)
        // Fixed h-14 (56) outer height — same as auth CTA pills. Border is
        // drawn inside that box so it does not grow past the button.
        style={[
          {
            height: THEMED_TEXT_INPUT_HEIGHT,
            borderWidth: 1,
            borderColor: fieldBorder,
            backgroundColor: fieldFill,
          },
          style,
        ]}
      >
        <TextInput
          ref={ref}
          className="flex-1 text-base"
          // DYNAMIC-COLOR (theme-driven text color from ScreenThemeContext)
          style={[{ color: textColor, paddingVertical: 0 }, inputStyle]}
          placeholderTextColor={
            dark ? "rgba(255,255,255,0.35)" : textColor + "80"
          }
          keyboardAppearance={keyboardAppearance ?? (dark ? "dark" : "light")}
          selectionColor={
            selectionColor ??
            (dark ? "rgba(255,255,255,0.35)" : textColor + "40")
          }
          cursorColor={cursorColor ?? textColor}
          underlineColorAndroid={underlineColorAndroid ?? "transparent"}
          {...textInputProps}
        />
        {buttonIcon && (
          <CircleButton
            icon={buttonIcon}
            label=""
            onPress={
              onButtonPress
                ? onButtonPress
                : () => console.log("No onButtonPress defined")
            }
            size={buttonSize}
            backgroundColor={
              withButtonBackground ? buttonBackground : "transparent"
            }
            iconColor={withButtonBackground ? iconColor : textColor}
            disabled={buttonDisabled}
          />
        )}
      </View>
    );
  }
);

ThemedTextInput.displayName = "ThemedTextInput";
