import React, { useRef, useState } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Spacing } from "@/constants/Spacing";
import History from "../atoms/icons/history";
import Home from "../atoms/icons/home";
import Settings from "../atoms/icons/settings";
import { ActionPill } from "../molecules";
import HapticPressable from "../atoms/HapticPressable";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { ActionMenu } from "./ActionMenu"; // Import ActionMenu

import { BlurView } from "expo-blur";
import { useSegments } from "expo-router";
import { BottomSheetModal } from "@gorhom/bottom-sheet";

const iconMappings = {
  index: Home,
  settings: Settings,
  history: History,
} as Record<string, React.FC<{ isActive?: boolean }>>;

export function CustomTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const segments = useSegments();
  const [isActionMenuVisible, setIsActionMenuVisible] = useState(false);

  const sendFlowModalRef = useRef<BottomSheetModal>(null);

  // Animation Shared Value
  const fabScale = useSharedValue(1);
  const fabOpacity = useSharedValue(1);

  const isHome = segments[0] === "(tabs)" && segments[1] === undefined;

  React.useEffect(() => {
    fabOpacity.value = withTiming(isActionMenuVisible ? 0 : 1, {
      duration: 200,
    });
  }, [isActionMenuVisible]);

  const fabStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: fabScale.value }],
      opacity: fabOpacity.value,
    };
  });

  const handleFabPress = () => {
    // Shrink and Grow Animation
    fabScale.value = withSequence(
      withTiming(0.9, { duration: 100 }),
      withSpring(1, { damping: 15, stiffness: 200 })
    );

    setIsActionMenuVisible(true);
  };

  return (
    <>
      <ContainerWrapper withBlur={!isHome}>
        {/* Left Pill - Navigation Tabs */}
        <ActionPill
          items={state.routes.map((route, index) => {
            const { options } = descriptors[route.key];
            const isFocused = state.index === index;

            const onPress = () => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });

              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            const onLongPress = () => {
              navigation.emit({
                type: "tabLongPress",
                target: route.key,
              });
            };

            return {
              icon: iconMappings[route.name],
              onPress,
              onLongPress,
              isActive: isFocused,
              accessibilityLabel: options.tabBarAccessibilityLabel,
              testID: options.title,
            };
          })}
          containerStyle={
            isHome ? { shadowColor: "transparent", elevation: 0 } : {}
          }
        />

        {/* Right FAB - Action Button */}
        {isHome && (
          <Animated.View style={[styles.fabContainer, fabStyle]}>
            <HapticPressable
              style={[styles.fab, { backgroundColor: "#000" }]}
              onPress={handleFabPress}
            >
              <Ionicons name="add" size={28} color="white" />
            </HapticPressable>
          </Animated.View>
        )}
      </ContainerWrapper>

      {/* Action Menu Overlay */}
      <ActionMenu
        visible={isActionMenuVisible}
        onClose={() => setIsActionMenuVisible(false)}
      />

      {/* <SendFlowModal
                ref={sendFlowModalRef}
                onClose={() => { }}
            /> */}
    </>
  );
}

const ContainerWrapper = ({
  children,
  withBlur,
}: {
  children: React.ReactNode;
  withBlur?: boolean;
}) => {
  const insets = useSafeAreaInsets();
  if (!withBlur) {
    return (
      <View style={[styles.container, { bottom: insets.bottom + Spacing.sm }]}>
        {children}
      </View>
    );
  }
  return (
    <BlurView
      intensity={10}
      tint="light"
      style={[styles.container, { bottom: insets.bottom + Spacing.sm }]}
      experimentalBlurMethod="dimezisBlurView"
    >
      {children}
    </BlurView>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingLeft: Spacing.md,
    paddingRight: Spacing.md,
    left: 0,
    right: 0,
    paddingTop: 10,
    zIndex: 1, // Ensure container is above content but below menu
  },
  fabContainer: {
    position: "absolute",
    top: 12,
    right: Spacing.md,
    zIndex: 2,
  },
  fab: {
    width: 50,
    height: 50,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    // Shadow for FAB
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
});
