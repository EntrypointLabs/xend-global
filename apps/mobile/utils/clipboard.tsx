import React from "react";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { showToast } from "@/utils/toast";

export async function copyToClipboard(value: string, label: string) {
  await Clipboard.setStringAsync(value);
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  showToast(
    `Copied ${label}`,
    <Ionicons name="checkmark-circle" size={16} color="black" />
  );
}
