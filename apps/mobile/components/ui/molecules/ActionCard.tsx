import React from "react";
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Dimensions,
  Image,
  ImageSourcePropType,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/ui/atoms";
import { Spacing } from "@/constants/Spacing";
import { useThemeColor } from "@/hooks/useThemeColor";
import HapticPressable from "../atoms/HapticPressable";

interface ActionCardProps {
  title: string;
  subtitle: string;
  icon: ImageSourcePropType;
  onPress: () => void;
  iconColor?: string;
  iconBackgroundColor?: string;
}

const { width } = Dimensions.get("window");
const CARD_GAP = 16;
const CARD_WIDTH = (width - CARD_GAP * 3) / 2; // 2 columns with outer padding and gap

export function ActionCard({
  title,
  subtitle,
  icon,
  onPress,
  iconBackgroundColor,
}: ActionCardProps) {
  const cardBackgroundColor = useThemeColor({}, "card");
  const primaryColor = useThemeColor({}, "primary");

  return (
    <HapticPressable
      style={[
        { width: CARD_WIDTH },
        styles.container,
        { backgroundColor: cardBackgroundColor },
      ]}
      className="mb-4 min-h-[140px] justify-between gap-10 rounded-2xl border border-dashed border-black/[0.12] px-4 py-6"
      onPress={onPress}
    >
      <Image source={icon} className="size-10" resizeMode="contain" />

      <View style={styles.textContainer}>
        <ThemedText type="defaultSemiBold" style={styles.title}>
          {title}
        </ThemedText>
        <ThemedText type="small" style={styles.subtitle}>
          {subtitle}
        </ThemedText>
      </View>
    </HapticPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    // // Shadow for depth
    // shadowColor: "#000",
    // shadowOffset: {
    //     width: 0,
    //     height: 2,
    // },
    // shadowOpacity: 0.05,
    // shadowRadius: 3.84,
    // elevation: 2,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  textContainer: {
    gap: 4,
  },
  title: {
    fontSize: 16,
  },
  subtitle: {
    opacity: 0.6,
    fontSize: 13,
  },
});
