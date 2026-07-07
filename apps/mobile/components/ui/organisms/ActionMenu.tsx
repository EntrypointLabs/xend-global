import React, { useMemo } from "react";
import { Modal, View, StyleSheet, Image } from "react-native";
import { FrostBlurView } from "@/components/ui/atoms/FrostBlurView";
import Animated, { SlideInDown, SlideOutDown } from "react-native-reanimated";
import { Typography } from "../atoms/Typography";
import { useModalFlow } from "@/contexts/ModalFlowContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import HapticPressable from "../atoms/HapticPressable";

interface ActionMenuProps {
  visible: boolean;
  onClose: () => void;
}

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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View className="flex-1 items-end justify-end">
        <FrostBlurView
          // MEASURED-LAYOUT (absoluteFill)
          style={StyleSheet.absoluteFill}
        >
          <HapticPressable className="flex-1" onPress={onClose} />
        </FrostBlurView>

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
    </Modal>
  );
};
