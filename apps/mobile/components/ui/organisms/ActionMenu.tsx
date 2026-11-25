import React, { useEffect, useMemo, useState } from "react";
import { Modal, View, StyleSheet, Image } from "react-native";
import { FrostBlurView } from "@/components/ui/atoms/FrostBlurView";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Typography } from "../atoms/Typography";
import { useFeature } from "@/hooks/useFeature";
import { useModalFlow } from "@/contexts/ModalFlowContext";
import { useSendGate } from "@/hooks/useSendGate";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import HapticPressable from "../atoms/HapticPressable";
import { useRouter } from "expo-router";
import { useColorfulTheme } from "@/contexts/AppearanceContext";
import { usePalette } from "@/hooks/usePalette";
import { cn } from "@/utils/cn";

interface ActionMenuProps {
  visible: boolean;
  onClose: () => void;
}

/** The size the stack grows from, at the + button, before it springs open. */
const FOLDED_SCALE = 0.4;
const CLOSE_MS = 130;

export const ActionMenu: React.FC<ActionMenuProps> = ({ visible, onClose }) => {
  const { showSendModal, showReceiveModal } = useModalFlow();
  const gateSend = useSendGate();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const swapEnabled = useFeature("swap");
  // The menu only opens from Home: on its photo the frost is dark and the
  // labels white, on the monochrome Home both follow the mode.
  const dark = useColorfulTheme();
  const palette = usePalette();
  const reduceMotion = useReducedMotion();

  // Held open past `visible` so the stack can fold back into the + button
  // before the modal goes.
  const [shown, setShown] = useState(visible);
  const open = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setShown(true);
      open.value = reduceMotion
        ? withTiming(1, { duration: 150 })
        : withSpring(1, { duration: 350, dampingRatio: 0.7 });
    } else {
      open.value = withTiming(
        0,
        { duration: CLOSE_MS, easing: Easing.in(Easing.quad) },
        (finished) => {
          if (finished) runOnJS(setShown)(false);
        }
      );
    }
  }, [visible, reduceMotion, open]);

  const backdrop = useAnimatedStyle(() => ({
    opacity: interpolate(open.value, [0, 0.6], [0, 1], Extrapolation.CLAMP),
  }));

  // The stack grows out of the + button's corner, as Fuse's does, and folds
  // back into it on close.
  const stack = useAnimatedStyle(() => ({
    // Anchored on the + button, which sits under the stack's corner.
    transformOrigin: "100% 100%",
    opacity: interpolate(open.value, [0, 0.5], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        scale: reduceMotion
          ? 1
          : interpolate(open.value, [0, 1], [FOLDED_SCALE, 1]),
      },
    ],
  }));

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
        onPress: () => gateSend(showSendModal),
        disabled: false,
      },
      ...(swapEnabled
        ? [
            {
              title: "Swap",
              icon: require("@/assets/icons/swap.png"),
              onPress: () => router.push("/swap"),
              disabled: false,
            },
          ]
        : []),
      {
        title: "Earn",
        icon: require("@/assets/icons/earn.png"),
        onPress: () => router.push("/earn"),
        disabled: false,
      },
    ] as const;
  }, [showReceiveModal, showSendModal, gateSend, router, swapEnabled]);

  return (
    <Modal
      visible={shown}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View className="flex-1 items-end justify-end">
        <Animated.View style={[StyleSheet.absoluteFill, backdrop]}>
          {/* The bright frost, not the grey veil the sheets use: the labels
              here are dark, and grey behind them makes them hard to read. */}
          <FrostBlurView
            veil={false}
            tint={dark || palette.dark ? "dark" : "light"}
            // MEASURED-LAYOUT (absoluteFill)
            style={StyleSheet.absoluteFill}
          >
            {/* A light frost alone cannot lift a dark photo card to white,
                so in light mode a white wash goes over it: the labels then
                sit on near-white whatever Home shows beneath them. */}
            <HapticPressable
              className={cn(
                "flex-1",
                dark ? "bg-black/30" : !palette.dark && "bg-white/50"
              )}
              onPress={onClose}
            />
          </FrostBlurView>
        </Animated.View>

        <View
          className="absolute right-4"
          // MEASURED-LAYOUT (safe-area inset)
          style={{ bottom: insets.bottom + 8 }}
        >
          <Animated.View style={stack}>
            <View className="flex flex-col items-end">
              {menus.map((menu) => (
                <HapticPressable
                  key={menu.title}
                  className="flex-row items-center py-6"
                  onPress={() => {
                    onClose();
                    setTimeout(menu.onPress, 10);
                  }}
                >
                  <Typography
                    weight="600"
                    className={cn(
                      "text-lg",
                      dark ? "text-white" : "text-foreground"
                    )}
                  >
                    {menu.title}
                  </Typography>
                  {/* As wide as the + button, so each icon sits centred
                      over it instead of against the screen edge. */}
                  <View className="w-[50px] items-center">
                    <Image
                      source={menu.icon}
                      className="size-7"
                      resizeMode="contain"
                    />
                  </View>
                </HapticPressable>
              ))}
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
};
