import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Toggle } from "@/components/ui/atoms/Toggle";
import { Typography } from "@/components/ui/atoms/Typography";
import { ActionModal } from "@/components/ui/organisms/ActionModal";
import {
  HOME_WIDGETS,
  type HomeWidgetKey,
  type HomeWidgetVisibility,
} from "@/utils/homeWidgets";

interface WidgetsModalProps {
  visible: boolean;
  onClose: () => void;
  visibility: HomeWidgetVisibility;
  onChange: (key: HomeWidgetKey, visible: boolean) => void;
}

export function WidgetsModal({
  visible,
  onClose,
  visibility,
  onChange,
}: WidgetsModalProps) {
  return (
    <ActionModal visible={visible} onClose={onClose}>
      <View className="mb-5 flex-col items-center justify-center">
        <View className="mb-5">
          <Ionicons name="grid-outline" size={30} color="#000" />
        </View>
        <Typography weight="600" className="mb-1 text-base">
          Home widgets
        </Typography>
        <Typography
          weight="500"
          className="max-w-[220px] text-center text-sm text-black/40"
        >
          Choose what shows on your Home screen
        </Typography>
      </View>
      <View>
        {HOME_WIDGETS.map(({ key, title, detail }) => (
          <View key={key} className="flex-row items-center py-3">
            <View className="flex-1 pr-4">
              <Typography weight="600" className="text-base">
                {title}
              </Typography>
              <Typography weight="500" className="text-xs text-black/40">
                {detail}
              </Typography>
            </View>
            <Toggle
              value={visibility[key]}
              onValueChange={(value) => onChange(key, value)}
            />
          </View>
        ))}
      </View>
    </ActionModal>
  );
}
