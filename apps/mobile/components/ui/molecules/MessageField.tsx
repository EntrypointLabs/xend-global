import React from "react";
import { TextInput, View } from "react-native";

import { usePalette } from "@/hooks/usePalette";

/** Long enough for a real account of a problem, short enough to stay a message. */
export const MESSAGE_MAX_LENGTH = 4000;

/**
 * How far below the safe area a screen's content starts, which is the padding
 * `ScreenLayout` puts around it. A screen that lifts its send button over the
 * keyboard has to add this and the top inset to the lift: the avoiding view
 * measures itself against its parent, not against the screen, and comes up
 * short by exactly that much otherwise.
 */
export const MESSAGE_SCREEN_INSET = 17.5;

interface MessageFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  editable?: boolean;
}

/** The one large box a Consumer writes to the team in. */
export function MessageField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  editable = true,
}: MessageFieldProps) {
  const palette = usePalette();
  return (
    // Gives up height before anything else does: with the keyboard up the
    // send button below has to stay on screen, and the box is the one thing
    // that can be smaller and still do its job.
    <View className="h-[168px] min-h-[96px] shrink rounded-3xl bg-foreground/[0.03] px-5 py-4">
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.fg(0.25)}
        keyboardAppearance={palette.dark ? "dark" : "light"}
        accessibilityLabel={accessibilityLabel}
        multiline
        autoFocus
        maxLength={MESSAGE_MAX_LENGTH}
        textAlignVertical="top"
        editable={editable}
        className="flex-1 text-[15px] leading-[22px] text-foreground"
      />
    </View>
  );
}
