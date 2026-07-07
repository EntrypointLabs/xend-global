import React, { createContext, useContext, useRef } from "react";
import { View } from "react-native";
import { BlurTargetView } from "expo-blur";

type BlurTargetRef = React.RefObject<View | null>;

const BlurTargetContext = createContext<BlurTargetRef | null>(null);

/**
 * The ref to pass to a BlurView's `blurTarget` so it can render a real blur of
 * the app content on Android (iOS blurs natively and ignores it). Null outside
 * the provider.
 */
export function useBlurTarget(): BlurTargetRef | null {
  return useContext(BlurTargetContext);
}

export function BlurTargetProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const ref = useRef<View>(null);
  return (
    <BlurTargetContext.Provider value={ref}>
      <BlurTargetView ref={ref} style={{ flex: 1 }}>
        {children}
      </BlurTargetView>
    </BlurTargetContext.Provider>
  );
}
