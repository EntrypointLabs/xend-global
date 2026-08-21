import { Modal, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import HapticPressable from "../atoms/HapticPressable";
import { Typography } from "../atoms/Typography";
import type { PopoverAnchor } from "./ContactActionsPopover";

interface KeyActionsPopoverProps {
  visible: boolean;
  anchor: PopoverAnchor | null;
  onClose: () => void;
  onInfo: () => void;
  onExplorer: () => void;
  /** Absent when this key cannot be removed, so no row is offered. */
  onDelete?: () => void;
  /**
   * Wording for the destructive row. A key whose change is still in flight is
   * cancelled rather than deleted, and calling that "Delete key" would suggest
   * removing something that was never added.
   */
  deleteLabel?: string;
}

const MENU_WIDTH = 220;
const MENU_OFFSET_Y = 4;
const DESTRUCTIVE = "#F90101";

export function KeyActionsPopover({
  visible,
  anchor,
  onClose,
  onInfo,
  onExplorer,
  onDelete,
  deleteLabel = "Delete key",
}: KeyActionsPopoverProps) {
  if (!anchor) return null;

  const top = anchor.y + anchor.height + MENU_OFFSET_Y;
  const left = Math.max(8, anchor.x + anchor.width - MENU_WIDTH);

  // Closing first, then acting: the menu sits in its own Modal, and presenting
  // a sheet underneath one that is still up leaves the sheet unreachable.
  const pick = (action: () => void) => () => {
    onClose();
    setTimeout(action, 10);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View
        style={[styles.menu, { top, left, width: MENU_WIDTH }]}
        pointerEvents="box-none"
      >
        <Row
          icon="help-circle-outline"
          label="More info"
          onPress={pick(onInfo)}
        />
        <Row
          icon="compass-outline"
          label="Explorer"
          onPress={pick(onExplorer)}
        />
        {onDelete && (
          <>
            <Row
              icon="trash-outline"
              label={deleteLabel}
              onPress={pick(onDelete)}
              destructive
            />
          </>
        )}
      </View>
    </Modal>
  );
}

function Row({
  icon,
  label,
  onPress,
  destructive,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <HapticPressable
      className="flex-row items-center gap-4 px-6 py-3"
      onPress={onPress}
    >
      <Ionicons
        name={icon}
        size={16}
        color={destructive ? DESTRUCTIVE : "#000"}
      />
      <Typography
        weight="500"
        className="text-base"
        // DYNAMIC-COLOR (destructive stays a glyph and a word, never a fill)
        style={destructive ? { color: DESTRUCTIVE } : undefined}
      >
        {label}
      </Typography>
    </HapticPressable>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: "absolute",
    backgroundColor: "#F9F9F9",
    borderRadius: 16,
    paddingVertical: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
});
