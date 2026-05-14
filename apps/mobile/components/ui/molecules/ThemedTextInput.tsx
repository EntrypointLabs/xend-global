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
import { cn } from "@/utils/cn";

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
      ...textInputProps
    },
    ref
  ) => {
    const { textColor, backgroundColor } = useScreenTheme();

    const isBackgroundDark =
      backgroundColor === "#000000" || backgroundColor.toLowerCase() === "#000";
    const buttonBackground = isBackgroundDark ? "#FFFFFF" : "#000000";
    const iconColor = isBackgroundDark ? "#000000" : "#FFFFFF";

    return (
      <View
        className={cn(
          "w-full flex-row items-center rounded-[42px] border-[0.5px] px-3 py-2",
          error ? "border-destructive" : "border-foreground/20",
          "bg-foreground/20"
        )}
        // MEASURED-LAYOUT
        style={style}
      >
        <TextInput
          ref={ref}
          className="h-10 flex-1 pl-3 text-base"
          // DYNAMIC-COLOR (theme-driven text color from ScreenThemeContext)
          style={[{ color: textColor }, inputStyle]}
          placeholderTextColor={textColor + "80"}
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
          />
        )}
      </View>
    );
  }
);

ThemedTextInput.displayName = "ThemedTextInput";
