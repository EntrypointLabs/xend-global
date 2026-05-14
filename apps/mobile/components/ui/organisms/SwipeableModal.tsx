import React, { useRef } from "react";
import { Animated, PanResponder, View, ViewStyle } from "react-native";

interface SwipeableModalProps {
  children: React.ReactNode;
  onDismiss: () => void;
  style?: ViewStyle;
  pullIndicatorColor?: string;
  showPullIndicator?: boolean;
}

export function SwipeableModal({
  children,
  onDismiss,
  style,
  pullIndicatorColor = "rgba(255, 255, 255, 0.3)",
  showPullIndicator = true,
}: SwipeableModalProps) {
  const pan = useRef(new Animated.ValueXY()).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dy) > 10 && gestureState.dy > 0;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          pan.y.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (
          gestureState.dy > 150 ||
          (gestureState.vy > 0.5 && gestureState.dy > 50)
        ) {
          onDismiss();
        } else {
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  return (
    // GESTURE-DRIVEN
    <Animated.View
      className="flex-1"
      style={[style, { transform: [{ translateY: pan.y }] }]}
      {...panResponder.panHandlers}
    >
      {showPullIndicator && (
        <View
          className="mb-[15px] mt-2.5 h-[5px] w-10 self-center rounded-[3px]"
          // DYNAMIC-COLOR (user-controllable indicator tint)
          style={{ backgroundColor: pullIndicatorColor }}
        />
      )}
      {children}
    </Animated.View>
  );
}
