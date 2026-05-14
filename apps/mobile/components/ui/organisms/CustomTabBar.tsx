import React, { useState } from "react";
import { View } from "react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { ActionMenu } from "./ActionMenu";

import { BlurView } from "expo-blur";
import { useSegments } from "expo-router";

const iconMappings = {
  index: Home,
  settings: Settings,
  history: History,
} as Record<string, React.FC<{ isActive?: boolean }>>;

const fabShadow = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.3,
  shadowRadius: 4.65,
  elevation: 8,
};

export function CustomTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const segments = useSegments();
  const [isActionMenuVisible, setIsActionMenuVisible] = useState(false);

  const fabScale = useSharedValue(1);
  const fabOpacity = useSharedValue(1);

  const isHome = segments[0] === "(tabs)" && segments[1] === undefined;

  React.useEffect(() => {
    fabOpacity.value = withTiming(isActionMenuVisible ? 0 : 1, {
      duration: 200,
    });
  }, [isActionMenuVisible, fabOpacity]);

  const fabStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: fabScale.value }],
      opacity: fabOpacity.value,
    };
  });

  const handleFabPress = () => {
    fabScale.value = withSequence(
      withTiming(0.9, { duration: 100 }),
      withSpring(1, { damping: 15, stiffness: 200 })
    );

    setIsActionMenuVisible(true);
  };

  return (
    <>
      <ContainerWrapper withBlur={!isHome}>
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

        {isHome && (
          // REANIMATED-EXCEPTION
          <Animated.View
            className="absolute right-3 top-3 z-[2]"
            style={fabStyle}
          >
            <HapticPressable
              className="h-[50px] w-[50px] items-center justify-center rounded-[28px] bg-black"
              // PLATFORM-SHADOW
              style={fabShadow}
              onPress={handleFabPress}
            >
              <Ionicons name="add" size={28} color="white" />
            </HapticPressable>
          </Animated.View>
        )}
      </ContainerWrapper>

      <ActionMenu
        visible={isActionMenuVisible}
        onClose={() => setIsActionMenuVisible(false)}
      />
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
  const bottom = insets.bottom + 8;
  if (!withBlur) {
    return (
      <View
        className="absolute left-0 right-0 z-[1] flex-row items-center justify-between px-3 pt-2.5"
        // MEASURED-LAYOUT (safe-area inset)
        style={{ bottom }}
      >
        {children}
      </View>
    );
  }
  return (
    <BlurView
      intensity={10}
      tint="light"
      className="absolute left-0 right-0 z-[1] flex-row items-center justify-between px-3 pt-2.5"
      // MEASURED-LAYOUT (safe-area inset)
      style={{ bottom }}
      experimentalBlurMethod="dimezisBlurView"
    >
      {children}
    </BlurView>
  );
};
