import React from "react";
import { StyleProp, View, ViewStyle } from "react-native";
import HapticPressable from "@/components/ui/atoms/HapticPressable";

export interface ActionPillItem {
  icon: React.FC<{ isActive?: boolean; size?: number }>;
  label?: string;
  onPress: () => void;
  onLongPress?: () => void;
  isActive?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

export interface ActionPillProps {
  items: ActionPillItem[];
  containerStyle?: StyleProp<ViewStyle>;
}

export function ActionPill({ items, containerStyle }: ActionPillProps) {
  const shadowStyle = {
    shadowColor: "#CECECE",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 1,
  };

  return (
    <View
      className="flex-row items-center gap-7 rounded-full bg-white px-5 py-3"
      // PLATFORM-SHADOW
      style={[shadowStyle, containerStyle]}
    >
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <HapticPressable
            key={index}
            accessibilityRole="button"
            accessibilityState={item.isActive ? { selected: true } : {}}
            accessibilityLabel={item.accessibilityLabel}
            testID={item.testID}
            onPress={item.onPress}
            onLongPress={item.onLongPress}
            className="items-center justify-center"
          >
            <Icon isActive={item.isActive} size={24} />
          </HapticPressable>
        );
      })}
    </View>
  );
}
