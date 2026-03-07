import React from "react";
import { View, ViewStyle } from "react-native";
import { SafeAreaView, Edge } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

interface ThemedScreenProps {
  children: React.ReactNode;
  style?: ViewStyle;
  useSafeArea?: boolean;
  safeAreaEdges?: Edge[];
}

export function ThemedScreen({
  children,
  style,
  useSafeArea = true,
  safeAreaEdges = ["top", "right", "bottom", "left"],
}: ThemedScreenProps) {
  const statusBarStyle = "dark";
  const className = "flex-1 bg-white/90";

  const content = (
    <>
      <StatusBar style={statusBarStyle} />
      <View
        style={[{ backgroundColor: "rgba(255, 255, 255, 90)" }, style]}
        className={className}
      >
        {children}
      </View>
    </>
  );

  if (useSafeArea) {
    return (
      <SafeAreaView
        edges={safeAreaEdges}
        className={className}
        style={[{ backgroundColor: "rgba(255, 255, 255, 90)" }]}
      >
        {content}
      </SafeAreaView>
    );
  }

  return <View className={className}>{content}</View>;
}
