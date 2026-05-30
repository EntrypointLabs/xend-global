import React, { useState } from "react";
import {
  View,
  ActivityIndicator,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { WebView } from "react-native-webview";
import { useThemeColor } from "@/hooks/useThemeColor";
import { IconSymbol } from "@/components/ui/atoms";

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
  const textColor = useThemeColor({}, "text");

  if (!visible) return null;

  return (
    <View className="absolute inset-0 z-[1000] bg-black/50">
      <View className="h-[60px] flex-row items-center justify-end bg-white px-6">
        <TouchableOpacity onPress={onClose} className="p-2">
          <IconSymbol name="xmark" size={24} color={textColor} />
        </TouchableOpacity>
      </View>
      {isLoading && (
        <View
          className="z-[1] items-center justify-center bg-white/90"
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
        allowFileAccess={true}
        allowFileAccessFromFileURLs={true}
        allowUniversalAccessFromFileURLs={true}
        androidHardwareAccelerationDisabled={false}
        androidLayerType="hardware"
      />
    </View>
  );
}
