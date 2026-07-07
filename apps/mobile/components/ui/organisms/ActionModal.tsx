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
import { FrostBlurView } from "@/components/ui/atoms/FrostBlurView";
import { ThemedText } from "@/components/ui/atoms";
import { useThemeColor } from "@/hooks/useThemeColor";
import Animated, {
  useSharedValue,
  // useAnimatedStyle,
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

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  modalContainer: {
    width: "93%",
    borderRadius: 32,
    paddingHorizontal: 24,
    paddingVertical: 20,
    margin: 21,
    overflow: "hidden",
    position: "relative",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    zIndex: 1,
  },
  contentContainer: {
    zIndex: 1,
  },
  closeButton: {
    opacity: 0.25,
  },
  closeText: {
    fontSize: 28,
  },
});

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

  // const animatedStyle = useAnimatedStyle(() => {
  //   return {
  //     transform: [{ translateY: translateY.value }],
  //   };
  // });

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <TouchableOpacity
          style={{ flex: 1 }}
          activeOpacity={1}
          onPress={onClose}
        >
          <FrostBlurView style={[styles.overlay, StyleSheet.absoluteFill]}>
            <TouchableWithoutFeedback>
              <GestureDetector gesture={pan}>
                {/* REANIMATED-EXCEPTION */}
                <Animated.View
                  style={[
                    styles.modalContainer,
                    {
                      backgroundColor: useStarburstModal
                        ? "#000"
                        : backgroundColor,
                    },
                    // animatedStyle,
                  ]}
                >
                  {title ? (
                    <View style={styles.header}>
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
                        style={styles.closeButton}
                      >
                        <Typography
                          weight="300"
                          // DYNAMIC-COLOR
                          style={[
                            styles.closeText,
                            {
                              color: useStarburstModal ? "white" : textColor,
                            },
                          ]}
                        >
                          ×
                        </Typography>
                      </TouchableOpacity>
                    </View>
                  ) : null}

                  <View style={styles.contentContainer}>{children}</View>
                </Animated.View>
              </GestureDetector>
            </TouchableWithoutFeedback>
          </FrostBlurView>
        </TouchableOpacity>
      </GestureHandlerRootView>
    </Modal>
  );
}
