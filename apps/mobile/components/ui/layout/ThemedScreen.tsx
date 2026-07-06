import React from "react";
import { View, ViewStyle, StyleProp } from "react-native";
import { SafeAreaView, Edge } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { cn } from "@/utils/cn";

interface ThemedScreenProps {
  children: React.ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
  useSafeArea?: boolean;
  safeAreaEdges?: Edge[];
}

export function ThemedScreen({
  children,
  className,
  style,
  useSafeArea = true,
  safeAreaEdges = ["top", "right", "bottom", "left"],
}: ThemedScreenProps) {
  const containerClass = cn("flex-1 bg-white", className);

  const content = (
    <>
      <StatusBar style="dark" />
      {/* MEASURED-LAYOUT */}
      <View className={containerClass} style={style}>
        {children}
      </View>
    </>
  );

  if (useSafeArea) {
    return (
      // MEASURED-LAYOUT
      <SafeAreaView
        edges={safeAreaEdges}
        className={containerClass}
        style={style}
      >
        {content}
      </SafeAreaView>
    );
  }

  return <View className={containerClass}>{content}</View>;
}
