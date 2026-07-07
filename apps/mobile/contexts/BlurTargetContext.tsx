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

/**
 * Provides the blur-target ref. Must sit ABOVE the bottom-sheet portal provider
 * so sheet backdrops (which render in that portal, outside the screen tree) can
 * still read the ref.
 */
export function BlurTargetProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const ref = useRef<View>(null);
  return (
    <BlurTargetContext.Provider value={ref}>
      {children}
    </BlurTargetContext.Provider>
  );
}

/**
 * Wraps the app content in the actual BlurTargetView that BlurViews snapshot.
 * Place it around the screen output; the provider above supplies the ref.
 */
export function BlurTargetHost({ children }: { children: React.ReactNode }) {
  const ref = useBlurTarget();
  return (
    <BlurTargetView ref={ref ?? undefined} style={{ flex: 1 }}>
      {children}
    </BlurTargetView>
  );
}
