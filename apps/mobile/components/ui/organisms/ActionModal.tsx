import React, { ReactElement, useEffect } from "react";
import {
  Modal,
  StyleSheet,
  View,
  TouchableOpacity,
  Dimensions,
  TouchableWithoutFeedback,
} from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import { BlurView } from "expo-blur";
import { ThemedText } from "@/components/ui/atoms";
import { useThemeColor } from "@/hooks/useThemeColor";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { runOnJS } from "react-native-worklets";
import {
  GestureDetector,
  Gesture,
  GestureHandlerRootView,
} from "react-native-gesture-handler";

export interface ActionModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  useStarburstModal?: boolean;
  primaryColor?: string;
}

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const SWIPE_THRESHOLD = 150;

export function ActionModal({
  visible,
  onClose,
  title = "",
  children,
  useStarburstModal = false,
}: ActionModalProps): ReactElement {
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");

  const translateY = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      translateY.value = withSpring(0, { damping: 15 });
    } else {
      translateY.value = SCREEN_HEIGHT;
    }
  }, [visible, translateY]);

  const handleClose = () => {
    translateY.value = 0;
    onClose();
  };

  const pan = Gesture.Pan()
    .onChange((event) => {
      if (event.translationY > 0) {
        translateY.value = event.translationY;
      }
    })
    .onEnd((event) => {
      if (event.translationY > SWIPE_THRESHOLD || event.velocityY > 500) {
        runOnJS(handleClose)();
      } else {
        translateY.value = withSpring(0);
      }
    });

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: translateY.value }],
    };
  });

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <GestureHandlerRootView className="flex-1">
        <TouchableOpacity
          className="flex-1"
          activeOpacity={1}
          onPress={onClose}
        >
          <BlurView
            intensity={44.2}
            className="flex-1 items-center justify-end bg-[rgb(189,189,189)]"
            // MEASURED-LAYOUT (absoluteFill helper)
            style={StyleSheet.absoluteFill}
            tint="dark"
            experimentalBlurMethod="dimezisBlurView"
          >
            <TouchableWithoutFeedback>
              <GestureDetector gesture={pan}>
                {/* REANIMATED-EXCEPTION */}
                <Animated.View
                  className="relative m-[21px] w-[93%] overflow-hidden rounded-[32px] px-6 py-5"
                  style={[
                    {
                      backgroundColor: useStarburstModal
                        ? "#000"
                        : backgroundColor,
                    },
                    animatedStyle,
                  ]}
                >
                  {title ? (
                    <View className="z-10 mb-2 flex-row items-center justify-between">
                      <ThemedText
                        type="subtitle"
                        // DYNAMIC-COLOR
                        style={{
                          color: useStarburstModal ? "white" : textColor,
                        }}
                      >
                        {title}
                      </ThemedText>
                      <TouchableOpacity
                        onPress={onClose}
                        className="opacity-25"
                      >
                        <Typography
                          weight="300"
                          className="text-[28px]"
                          // DYNAMIC-COLOR
                          style={{
                            color: useStarburstModal ? "white" : textColor,
                          }}
                        >
                          ×
                        </Typography>
                      </TouchableOpacity>
                    </View>
                  ) : null}

                  <View className="z-10">{children}</View>
                </Animated.View>
              </GestureDetector>
            </TouchableWithoutFeedback>
          </BlurView>
        </TouchableOpacity>
      </GestureHandlerRootView>
    </Modal>
  );
}
