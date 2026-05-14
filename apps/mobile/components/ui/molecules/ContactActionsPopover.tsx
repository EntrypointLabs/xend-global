import React from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import HapticPressable from "../atoms/HapticPressable";
import { Typography } from "../atoms/Typography";

export interface PopoverAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ContactActionsPopoverProps {
  visible: boolean;
  anchor: PopoverAnchor | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const MENU_WIDTH = 180;
const MENU_OFFSET_Y = 4;

export function ContactActionsPopover({
  visible,
  anchor,
  onClose,
  onEdit,
  onDelete,
}: ContactActionsPopoverProps) {
  if (!anchor) return null;

  const top = anchor.y + anchor.height + MENU_OFFSET_Y;
  const right = anchor.x + anchor.width;
  const left = Math.max(8, right - MENU_WIDTH);

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
        <HapticPressable
          className="flex-row items-center gap-3 px-4 py-3"
          onPress={() => {
            onClose();
            setTimeout(onEdit, 10);
          }}
        >
          <Ionicons name="pencil-outline" size={18} color="#000" />
          <Typography weight="500" className="text-base text-black">
            Edit
          </Typography>
        </HapticPressable>
        <View className="mx-3 h-px bg-black/5" />
        <HapticPressable
          className="flex-row items-center gap-3 px-4 py-3"
          onPress={() => {
            onClose();
            setTimeout(onDelete, 10);
          }}
        >
          <Ionicons name="trash-outline" size={18} color="#F90101" />
          <Typography
            weight="500"
            className="text-base"
            style={{ color: "#F90101" }}
          >
            Delete
          </Typography>
        </HapticPressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: "absolute",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingVertical: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
});
