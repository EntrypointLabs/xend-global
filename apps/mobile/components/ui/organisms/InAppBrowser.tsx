import React, { useState } from "react";
import {
  View,
  ActivityIndicator,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { WebView } from "react-native-webview";
import { usePalette } from "@/hooks/usePalette";
import { IconSymbol } from "@/components/ui/atoms";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface InAppBrowserProps {
  visible: boolean;
  onClose: () => void;
  url: string;
  onNavigationStateChange?: (navState: unknown) => void;
  disableDragClose?: boolean;
}

export function InAppBrowser({
  visible,
  onClose,
  url,
  onNavigationStateChange,
}: InAppBrowserProps) {
  const [isLoading, setIsLoading] = useState(true);
  const textColor = usePalette().foreground;
  const insets = useSafeAreaInsets();

  if (!visible) return null;

  return (
    <View className="absolute inset-0 z-[1000] bg-black/50">
      <View
        className="flex-row items-center justify-end bg-background px-6"
        // MEASURED-LAYOUT (top inset so the close button clears the Android
        // status bar under edge-to-edge)
        style={{ paddingTop: insets.top, height: 60 + insets.top }}
      >
        <TouchableOpacity onPress={onClose} className="p-2">
          <IconSymbol name="xmark" size={24} color={textColor} />
        </TouchableOpacity>
      </View>
      {isLoading && (
        <View
          className="z-[1] items-center justify-center bg-background/90"
          // MEASURED-LAYOUT (absoluteFill)
          style={StyleSheet.absoluteFill}
        >
          <ActivityIndicator color={textColor} size="large" />
        </View>
      )}
      <WebView
        source={{ uri: url }}
        className="flex-1"
        onNavigationStateChange={onNavigationStateChange}
        onLoadStart={() => setIsLoading(true)}
        onLoadEnd={() => setIsLoading(false)}
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback={true}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        androidHardwareAccelerationDisabled={false}
        androidLayerType="hardware"
      />
    </View>
  );
}
