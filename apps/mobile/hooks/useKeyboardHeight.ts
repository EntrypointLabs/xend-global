import { useEffect, useState } from "react";
import { Keyboard, LayoutAnimation, Platform } from "react-native";

/**
 * How much of the screen the keyboard covers, in points, and zero while it is
 * away. The change is animated on the keyboard's own curve, so whatever is
 * padded by this rides up with it.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // iOS announces the keyboard before it moves; Android only after.
    const showing =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hiding =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const follow = (duration: number) => {
      if (Platform.OS !== "ios") return;
      LayoutAnimation.configureNext({
        duration,
        update: { type: LayoutAnimation.Types.keyboard },
      });
    };
    const shown = Keyboard.addListener(showing, (event) => {
      follow(event.duration);
      setHeight(event.endCoordinates.height);
    });
    const hidden = Keyboard.addListener(hiding, (event) => {
      follow(event.duration);
      setHeight(0);
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return height;
}
