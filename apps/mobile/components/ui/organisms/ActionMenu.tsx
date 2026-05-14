import React, { useMemo } from "react";
import { View, StyleSheet, Image } from "react-native";
import { BlurView } from "expo-blur";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from "react-native-reanimated";
import { Typography } from "../atoms/Typography";
import { useModalFlow } from "@/contexts/ModalFlowContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import HapticPressable from "../atoms/HapticPressable";

interface ActionMenuProps {
  visible: boolean;
  onClose: () => void;
}

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

export const ActionMenu: React.FC<ActionMenuProps> = ({ visible, onClose }) => {
  const { showSendModal, showReceiveModal } = useModalFlow();
  const insets = useSafeAreaInsets();

  const menus = useMemo(() => {
    return [
      {
        title: "Receive",
        icon: require("@/assets/icons/recieve.png"),
        onPress: showReceiveModal,
        disabled: false,
      },
      {
        title: "Send",
        icon: require("@/assets/icons/send.png"),
        onPress: showSendModal,
        disabled: false,
      },
      {
        title: "Swap",
        icon: require("@/assets/icons/swap.png"),
        onPress: () => {},
        disabled: true,
      },
    ] as const;
  }, [showReceiveModal, showSendModal]);

  if (!visible) return null;

  return (
    <View className="absolute inset-0 z-[1000] items-end justify-end">
      <AnimatedBlurView
        intensity={44.2}
        tint="light"
        // MEASURED-LAYOUT (absoluteFill)
        style={StyleSheet.absoluteFillObject}
        entering={FadeIn}
        exiting={FadeOut}
        experimentalBlurMethod="dimezisBlurView"
      >
        <HapticPressable className="flex-1" onPress={onClose} />
      </AnimatedBlurView>

      <View
        className="absolute right-4 flex flex-col items-end"
        // MEASURED-LAYOUT (safe-area inset)
        style={{ bottom: insets.bottom + 8 }}
      >
        {menus.map((menu) => (
          // REANIMATED-EXCEPTION
          <Animated.View
            entering={SlideInDown.springify(100).damping(20).stiffness(300)}
            exiting={SlideOutDown.springify(100).damping(20).stiffness(300)}
            className="items-end"
            key={menu.title}
          >
            <HapticPressable
              className="flex-row items-center gap-4 py-6"
              onPress={() => {
                onClose();
                setTimeout(menu.onPress, 10);
              }}
            >
              <Typography weight="600" className="text-lg text-black">
                {menu.title}
              </Typography>
              <Image
                source={menu.icon}
                className="size-7"
                resizeMode="contain"
              />
            </HapticPressable>
          </Animated.View>
        ))}
      </View>
    </View>
  );
};
